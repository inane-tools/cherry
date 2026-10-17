import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildActivity, createDiscordPresence, discordPaths, rpcFrame } from './discord.mjs';

const payload = { title: 'Song', artist: 'Artist', album: 'Album', artwork: 'https://i.ytimg.com/vi/example/hqdefault.jpg', videoId: 'video-id', isPlaying: true, positionSecs: 40, durationSecs: 200, statusDisplay: 'details' };
async function fixture(t, onFrame) {
  const path = process.platform === 'win32' ? discordPaths('win32')[0].replace('discord-ipc-0', 'cherry-discord-test-') + randomUUID() : join(tmpdir(), 'cherry-discord-' + randomUUID());
  const messages = [], sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8 && buffer.length >= buffer.readUInt32LE(4) + 8) {
        const opcode = buffer.readUInt32LE(0), size = buffer.readUInt32LE(4);
        const body = buffer.subarray(8, 8 + size); buffer = buffer.subarray(8 + size);
        const message = JSON.parse(body.toString()); messages.push({ opcode, ...message });
        if (onFrame?.(socket, opcode, message) === false) continue;
        if (opcode === 0) {
          // Deliberately fragment READY to exercise the IPC framing parser.
          const ready = rpcFrame(1, { evt: 'READY', data: {} });
          socket.write(ready.subarray(0, 5)); setImmediate(() => { if (!socket.destroyed) socket.write(ready.subarray(5)); });
        } else if (opcode === 1) socket.write(rpcFrame(1, { cmd: message.cmd, nonce: message.nonce, data: {} }));
      }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return { path, messages, sockets };
}

test('builds listening presence with artwork links, clocks and paused state', () => {
  const activity = buildActivity(payload, 1000);
  assert.equal(activity.type, 2); assert.equal(activity.status_display_type, 2);
  assert.deepEqual(activity.timestamps, { start: 960, end: 1160 });
  assert.equal(activity.assets.large_url, 'https://www.youtube.com/watch?v=video-id');
  assert.equal(activity.assets.small_url, 'https://inane.tools');
  const paused = buildActivity({ ...payload, isPlaying: false, isPaused: true, statusDisplay: 'state' }, 1000);
  assert.equal(paused.state, 'Artist · Paused'); assert.equal(paused.status_display_type, 1);
  assert.deepEqual(paused.timestamps, { start: 1000, end: 1000 });
  assert.ok(Buffer.byteLength(buildActivity({ title: '🎵'.repeat(100) }).details) <= 128);
});
test('uses Windows pipes and Unix/Flatpak runtime sockets', () => {
  assert.deepEqual([...discordPaths('win32')[0].slice(0, 4)].map(char => char.charCodeAt(0)), [92, 92, 63, 92]);
  const paths = discordPaths('linux', { XDG_RUNTIME_DIR: '/run/user/1000' });
  assert.ok(paths.includes('/run/user/1000/discord-ipc-0'));
  assert.ok(paths.includes('/run/user/1000/app/com.discordapp.Discord/discord-ipc-0'));
});
test('handshakes, serializes presence/clear and reconnects after clearing', async t => {
  const fixtureData = await fixture(t);
  const rpc = createDiscordPresence({ paths: [fixtureData.path], pid: 123, now: () => 1000 }); t.after(() => rpc.close());
  assert.equal((await rpc.setAppId('')).configured, true);
  await rpc.clear(); assert.equal(fixtureData.messages.length, 0);
  await Promise.all([rpc.setPresence(payload), rpc.clear()]);
  assert.deepEqual(fixtureData.messages.filter(m => m.opcode === 1).map(m => m.args.activity?.details ?? null), ['Song', null]);
  assert.equal(rpc.status().connected, false);
  await rpc.setPresence(payload);
  assert.equal(fixtureData.messages.filter(m => m.opcode === 0).length, 2);
  assert.equal(rpc.status().connected, true);
  await rpc.setAppId('123456789012345678');
  assert.equal(rpc.status().connected, false);
  await rpc.setPresence(payload);
  assert.equal(fixtureData.messages.at(-2).client_id, '123456789012345678');
  await assert.rejects(rpc.setAppId('not-an-id'), /Invalid Discord/);
});
test('surfaces Discord errors and reconnects on the next playback update', async t => {
  let rejectFirst = true;
  const f = await fixture(t, (socket, opcode, message) => {
    if (opcode === 1 && rejectFirst) { rejectFirst = false; socket.write(rpcFrame(1, { evt: 'ERROR', nonce: message.nonce, data: { message: 'Bad activity' } })); return false; }
  });
  const rpc = createDiscordPresence({ paths: [f.path] }); t.after(() => rpc.close());
  await assert.rejects(rpc.setPresence(payload), /Bad activity/);
  assert.equal(rpc.status().connected, false);
  await rpc.setPresence(payload); assert.equal(rpc.status().connected, true);
});
test('bounds stalled RPC requests and disconnects after failure', async t => {
  const f = await fixture(t, (_socket, opcode) => opcode !== 1);
  const rpc = createDiscordPresence({ paths: [f.path], timeoutMs: 100 }); t.after(() => rpc.close());
  await assert.rejects(rpc.setPresence(payload), /timed out/);
  assert.equal(rpc.status().connected, false);
  await rpc.clear();
});
test('rejects oversized IPC frames without keeping a connection alive', async t => {
  const f = await fixture(t, (socket, opcode) => {
    if (opcode === 0) { const header = Buffer.alloc(8); header.writeUInt32LE(1); header.writeUInt32LE(2 * 1024 * 1024, 4); socket.write(header); return false; }
  });
  const rpc = createDiscordPresence({ paths: [f.path] }); t.after(() => rpc.close());
  await assert.rejects(rpc.setPresence(payload), /socket is unavailable/);
  assert.equal(rpc.status().connected, false);
});
