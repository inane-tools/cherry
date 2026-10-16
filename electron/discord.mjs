import { createConnection } from 'node:net';
import { posix } from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_APP_ID = '1550170326481109063';
const MAX_FRAME = 1024 * 1024;

export function discordPaths(platform = process.platform, env = process.env) {
  if (platform === 'win32') return Array.from({ length: 10 }, (_, i) => String.fromCharCode(92, 92, 63, 92) + 'pipe' + String.fromCharCode(92) + 'discord-ipc-' + i);
  const roots = [...new Set([env.XDG_RUNTIME_DIR, env.TMPDIR, env.TMP, env.TEMP, '/tmp'].filter(Boolean))];
  return roots.flatMap(root => ['', 'app/com.discordapp.Discord', 'snap.discord'].flatMap(child =>
    Array.from({ length: 10 }, (_, i) => posix.join(root, child, `discord-ipc-${i}`))));
}

function clip(value, bytes = 128) {
  const text = String(value ?? '').trim();
  if (Buffer.byteLength(text) <= bytes) return text;
  let result = '';
  for (const char of text) {
    if (Buffer.byteLength(result + char + '…') > bytes) break;
    result += char;
  }
  return result + '…';
}
export function buildActivity(payload, now = Math.floor(Date.now() / 1000)) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid Discord presence');
  const activity = { type: 2, status_display_type: ({ name: 0, state: 1, details: 2 })[payload.statusDisplay] ?? 2, details: clip(payload.title) || 'Unknown' };
  const marker = payload.isPaused ? ' · Paused' : '';
  const artist = clip(payload.artist, 128 - Buffer.byteLength(marker));
  if (artist || payload.isPaused) activity.state = artist ? artist + marker : 'Paused';
  if (typeof payload.artwork === 'string' && payload.artwork.startsWith('https://') && payload.artwork.length < 2048) {
    activity.assets = { large_image: payload.artwork, small_image: 'cherry', small_text: 'Cherry · inane.tools', small_url: 'https://inane.tools' };
    if (typeof payload.videoId === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(payload.videoId)) activity.assets.large_url = 'https://www.youtube.com/watch?v=' + payload.videoId;
    if (payload.album) activity.assets.large_text = clip(payload.album);
  }
  const duration = Number.isFinite(payload.durationSecs) ? Math.max(0, Math.floor(payload.durationSecs)) : 0;
  if (payload.isPlaying && duration > 0) {
    const position = Number.isFinite(payload.positionSecs) ? Math.max(0, Math.min(duration, Math.floor(payload.positionSecs))) : 0;
    const start = Math.max(0, now - position);
    activity.timestamps = { start, end: start + duration };
  } else if (payload.isPaused) activity.timestamps = { start: now, end: now };
  return activity;
}

export function rpcFrame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(8); header.writeUInt32LE(opcode); header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

// One bounded parser per local socket: packets can be split or coalesced by IPC.
class RpcConnection {
  constructor(path, appId, connect, timeoutMs) {
    this.timeoutMs = timeoutMs;
    this.socket = connect({ path });
    this.pending = new Map(); this.buffer = Buffer.alloc(0); this.active = true;
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.timer = setTimeout(() => this.close(new Error('Discord connection timed out')), timeoutMs);
    this.socket.once('connect', () => this.socket.write(rpcFrame(0, { v: 1, client_id: appId })));
    this.socket.on('data', chunk => this.read(chunk));
    this.socket.on('error', error => this.close(error));
    this.socket.on('close', () => this.close(new Error('Discord disconnected')));
  }
  read(chunk) {
    if (!this.active) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    try {
      while (this.buffer.length >= 8) {
        const opcode = this.buffer.readUInt32LE(0), size = this.buffer.readUInt32LE(4);
        if (size > MAX_FRAME) throw new Error('Discord frame too large');
        if (this.buffer.length < size + 8) break;
        const body = this.buffer.subarray(8, 8 + size); this.buffer = this.buffer.subarray(8 + size);
        if (opcode === 3) { this.socket.write(rpcFrame(4, body)); continue; }
        if (opcode === 2) throw new Error('Discord closed the connection');
        if (opcode !== 1) continue;
        const message = JSON.parse(body.toString('utf8'));
        if (message.evt === 'READY') { clearTimeout(this.timer); this.resolveReady(this); }
        const pending = this.pending.get(message.nonce);
        if (pending) {
          this.pending.delete(message.nonce); clearTimeout(pending.timer);
          if (message.evt === 'ERROR') pending.reject(new Error(message.data?.message || 'Discord rejected presence'));
          else pending.resolve(message.data);
        }
      }
    } catch (error) { this.close(error); }
  }
  request(activity, pid) {
    if (!this.active) return Promise.reject(new Error('Discord disconnected'));
    return new Promise((resolve, reject) => {
      const nonce = randomUUID();
      const timer = setTimeout(() => this.close(new Error('Discord request timed out')), this.timeoutMs);
      this.pending.set(nonce, { resolve, reject, timer });
      this.socket.write(rpcFrame(1, { cmd: 'SET_ACTIVITY', args: { pid, activity }, nonce }));
    });
  }
  close(error = new Error('Discord connection closed')) {
    if (!this.active) return;
    this.active = false; clearTimeout(this.timer); this.rejectReady(error);
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); }
    this.pending.clear(); this.socket.destroy();
  }
}

export function createDiscordPresence({ paths = discordPaths(), connect = createConnection, timeoutMs = 2000, pid = process.pid, now = () => Math.floor(Date.now() / 1000) } = {}) {
  let appId = DEFAULT_APP_ID, connection, work = Promise.resolve(), disposed = false;
  const enqueue = task => { const result = work.then(() => { if (disposed) throw new Error('Discord integration closed'); return task(); }); work = result.catch(() => {}); return result; };
  const drop = () => { connection?.close(); connection = undefined; };
  const status = () => ({ appId, configured: true, connected: !!connection?.active });
  async function ensureConnection() {
    if (connection?.active) return connection;
    for (const path of paths) {
      const candidate = new RpcConnection(path, appId, connect, timeoutMs);
      try {
        await candidate.ready;
        if (disposed) { candidate.close(); throw new Error('Discord integration closed'); }
        connection = candidate; return candidate;
      } catch { candidate.close(); if (disposed) break; }
    }
    throw new Error('Discord is not running or its local RPC socket is unavailable');
  }
  return {
    status,
    setAppId: value => enqueue(async () => {
      const next = String(value ?? '').trim() || DEFAULT_APP_ID;
      if (!/^\d{16,20}$/.test(next)) throw new Error('Invalid Discord application ID');
      if (next !== appId) { drop(); appId = next; }
      return status();
    }),
    setPresence: payload => enqueue(async () => {
      const activity = buildActivity(payload, now());
      try { await (await ensureConnection()).request(activity, pid); }
      catch (error) { drop(); throw error; }
    }),
    clear: () => enqueue(async () => {
      // Clearing while disconnected must not start Discord or open a new connection.
      try { if (connection?.active) await connection.request(null, pid); }
      finally { drop(); }
    }),
    close: () => { disposed = true; drop(); },
  };
}
