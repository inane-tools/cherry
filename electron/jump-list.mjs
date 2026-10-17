import { createHash } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/.test(value);
export function playlistArgument(args) {
  for (let i = 0; i < args.length; i++) {
    const match = args[i].match(/^--(?:open|play)-playlist=(.*)$/);
    if (match && validId(match[1])) return match[1];
    if (['--open-playlist', '--play-playlist'].includes(args[i]) && validId(args[i + 1])) return args[i + 1];
  }
  return null;
}
export function createPlaylistLaunch(args, dispatch) {
  let pending = playlistArgument(args), ready = false;
  return {
    take() { ready = true; const value = pending; pending = null; return value; },
    reset() { ready = false; },
    receive(args) { const value = playlistArgument(args); if (!value) return; if (ready) dispatch(value); else pending = value; },
  };
}
function quoteArgument(value) { return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"'; }
function removedId(args = '') { return args.match(/(?:^|\s)--(?:open|play)-playlist(?:=|\s+)"?([a-zA-Z0-9_-]{1,256})"?(?:\s|$)/)?.[1]; }
export function buildJumpList({ pinned = [], recent = [], removedItems = [], minItems = 12, executable, launchPrefix = [], iconFor = () => executable }) {
  if (!Array.isArray(pinned) || !Array.isArray(recent)) throw new Error('Invalid playlist shortcuts');
  const removed = new Set(removedItems.map(item => removedId(item.args)));
  const used = new Set();
  let remaining = Math.max(0, Math.min(24, minItems));
  return [['Pinned playlists', pinned], ['Recent playlists', recent]].flatMap(([name, shortcuts]) => {
    const items = [];
    for (const shortcut of shortcuts.slice(0, 30)) {
      if (!remaining || !validId(shortcut?.browseId) || removed.has(shortcut.browseId) || used.has(shortcut.browseId)) continue;
      used.add(shortcut.browseId); remaining--;
      const title = String(shortcut.title || 'Playlist').slice(0, 128);
      items.push({ type: 'task', program: executable, args: [...launchPrefix.map(quoteArgument), '--open-playlist=' + shortcut.browseId].join(' '), title, description: ('Open ' + title).slice(0, 260), iconPath: iconFor(shortcut.thumbnail), iconIndex: 0 });
    }
    return items.length ? [{ type: 'custom', name, items }] : [];
  });
}

// Vista+ supports PNG data inside an ICO container, avoiding native build tools.
export function pngIcon(png, size = 64) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header[6] = header[7] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}
export function createJumpLists({ app, nativeImage, directory, iconPath, executable = process.execPath, platform = process.platform }) {
  const iconFile = thumbnail => join(directory, createHash('sha256').update(String(thumbnail)).digest('hex') + '.ico');
  let writes = Promise.resolve();
  return {
    async artworkCached(thumbnail) {
      if (platform !== 'win32' || !thumbnail) return true;
      try { await access(iconFile(thumbnail)); return true; } catch { return false; }
    },
    async cacheArtwork(thumbnail, pngBase64) {
      if (platform !== 'win32') return;
      if (typeof thumbnail !== 'string' || thumbnail.length > 4096 || typeof pngBase64 !== 'string' || pngBase64.length > 1024 * 1024) throw new Error('Invalid shortcut artwork');
      const bytes = Buffer.from(pngBase64, 'base64');
      if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Expected PNG shortcut artwork');
      // The renderer supplies a 64px canvas. Reject huge dimensions before decoding.
      if (bytes.readUInt32BE(16) !== 64 || bytes.readUInt32BE(20) !== 64) throw new Error('Shortcut artwork must be 64px');
      const image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) throw new Error('Invalid shortcut image');
      await mkdir(directory, { recursive: true });
      await writeFile(iconFile(thumbnail), pngIcon(image.resize({ width: 64, height: 64 }).toPNG()));
    },
    update(pinned = [], recent = []) {
      const task = writes.then(async () => {
        if (platform !== 'win32') return;
        if (!Array.isArray(pinned) || !Array.isArray(recent)) throw new Error('Invalid playlist shortcuts');
        const icons = new Map();
        for (const shortcut of [...pinned.slice(0, 30), ...recent.slice(0, 30)]) {
          if (!shortcut?.thumbnail || typeof shortcut.thumbnail !== 'string') continue;
          try { await access(iconFile(shortcut.thumbnail)); icons.set(shortcut.thumbnail, iconFile(shortcut.thumbnail)); } catch { /* app icon fallback */ }
        }
        const { minItems, removedItems } = app.getJumpListSettings();
        const categories = buildJumpList({ pinned, recent, removedItems, minItems, executable,
          launchPrefix: app.isPackaged ? [] : [app.getAppPath()], iconFor: thumbnail => icons.get(thumbnail) ?? iconPath });
        const result = app.setJumpList(categories);
        if (result !== 'ok') throw new Error('Windows Jump List update failed: ' + result);
      });
      writes = task.catch(() => {}); return task;
    },
  };
}
