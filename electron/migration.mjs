import { open, readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseLegacyLastfm } from './legacy-credentials.mjs';

const MAX_BYTES = 8 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length <= 4096 && !/[\u0000-\u001f]/.test(value);
const id = value => text(value) && value.length > 0 && value.length <= 256;
const booleans = new Set(`muted shuffle discordEnabled compactSidebar queueSidebar windowControls gradientsEnabled tintedBackground lyricsEnabled lyricsLookupEnabled playerShowLyrics videoPreferred videoLetterboxing playerShowPrev playerShowShuffle playerShowRepeat playerShowSleepTimer playerShowQueue lastfmEnabled lastfmNowPlaying`.split(' '));
const strings = new Set(`discordAppId channelPageId defaultPlaylistBrowseId defaultPlaylistTitle lastfmApiKey lastfmUsername`.split(' '));
const enums = { repeat: ['off', 'all', 'one'], discordStatusDisplay: ['details', 'state', 'name'], theme: ['system', 'light', 'dark'], accentSource: ['song', 'custom'] };
const ranges = { volume: [0, 1], uiZoom: [0.5, 2], sidebarWidth: [160, 600], lastfmScrobblePercent: [1, 100], lastfmMinDurationSeconds: [0, 3600] };
const array = (value, predicate) => Array.isArray(value) && value.length <= 10000 && value.every(predicate);
const playlist = value => object(value) && id(value.browseId) && text(value.title) &&
  (value.thumbnail === undefined || (text(value.thumbnail) && /^https:\/\//i.test(value.thumbnail)));
const unique = (values, key = value => value) => [...new Map(values.map(value => [key(value), value])).values()];

/** Import only known fields; credentials and developer switches never enter the new profile. */
export function parseLegacySettings(bytes) {
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('This is not a valid Cherry settings file.'); }
  if (!object(parsed) || !object(parsed.settings)) throw new Error('Choose the Tauri cherry-settings.json file, which contains a settings section.');
  const settings = {};
  let skipped = 0;
  for (const [key, value] of Object.entries(parsed.settings)) {
    let valid = false;
    if (booleans.has(key)) valid = typeof value === 'boolean';
    else if (strings.has(key)) valid = text(value);
    else if (Object.hasOwn(enums, key)) valid = enums[key].includes(value);
    else if (Object.hasOwn(ranges, key)) valid = typeof value === 'number' && Number.isFinite(value) && value >= ranges[key][0] && value <= ranges[key][1];
    else if (key === 'accentColor') valid = typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
    else if (key === 'videoQuality') valid = typeof value === 'string' && /^(highest|auto|\d{3,4}p?)$/.test(value);
    else if (['sidebarOrder', 'collapsedFolders'].includes(key)) valid = array(value, id);
    else if (['pinnedPlaylists', 'recentPlaylists'].includes(key)) valid = array(value, playlist);
    else if (key === 'playlistFolders') valid = array(value, folder => object(folder) && id(folder.id) && text(folder.name) && array(folder.playlistIds, id));
    else continue;
    if (!valid) { skipped++; continue; }
    if (['pinnedPlaylists', 'recentPlaylists'].includes(key)) settings[key] = unique(value.map(({ browseId, title, thumbnail }) => ({ browseId, title, ...(thumbnail ? { thumbnail } : {}) })), item => item.browseId);
    else if (key === 'playlistFolders') settings[key] = unique(value.map(({ id, name, playlistIds }) => ({ id, name, playlistIds: unique(playlistIds) })), item => item.id);
    else settings[key] = value;
  }
  if (!Object.keys(settings).length) throw new Error('No supported settings were found in this file.');
  return { settings, skipped };
}

export function mergeLegacySettings(legacy, current) {
  const result = { ...current, ...legacy };
  const scopes = { ...(current.pinnedPlaylistsByChannel ?? {}) };
  const scope = channel => `channel:${channel || 'personal'}`;
  const currentScope = scope(current.channelPageId);
  if (!Object.keys(scopes).length && current.pinnedPlaylists?.length) scopes[currentScope] = current.pinnedPlaylists;
  const legacyScope = scope(legacy.channelPageId);
  if (legacy.pinnedPlaylists?.length) {
    scopes[legacyScope] = unique([...legacy.pinnedPlaylists, ...(scopes[legacyScope] ?? [])], item => item.browseId);
  }
  result.pinnedPlaylistsByChannel = scopes;
  // Existing Electron items win ID collisions, rather than silently losing edits.
  for (const key of ['pinnedPlaylists', 'recentPlaylists']) {
    result[key] = unique([...(legacy[key] ?? []), ...(current[key] ?? [])], item => item.browseId);
  }
  result.playlistFolders = unique([...(legacy.playlistFolders ?? []), ...(current.playlistFolders ?? [])], item => item.id);
  const placed = new Set();
  // Preserve existing folder membership if the same playlist occurs in both profiles.
  const existingIds = new Set((current.playlistFolders ?? []).map(folder => folder.id));
  const priority = [...result.playlistFolders].sort((a, b) => Number(existingIds.has(b.id)) - Number(existingIds.has(a.id)));
  const folders = new Map(priority.map(folder => [folder.id, { ...folder, playlistIds: folder.playlistIds.filter(id => {
    if (placed.has(id)) return false;
    placed.add(id); return true;
  }) }]));
  result.playlistFolders = result.playlistFolders.map(folder => folders.get(folder.id));
  for (const key of ['sidebarOrder', 'collapsedFolders']) result[key] = unique([...(legacy[key] ?? []), ...(current[key] ?? [])]);
  return result;
}

/** Detection is best-effort. The native picker also works with Flatpak's document portal. */
export function legacySettingsPaths({ platform, appData, home, env = process.env }) {
  if (platform === 'win32') return [join(appData, 'com.cherry.app', 'cherry-settings.json'), join(appData, 'com.xylo.app', 'xylo-settings.json')];
  if (platform === 'linux') {
    const data = env.XDG_DATA_HOME || join(home, '.local', 'share');
    return [join(data, 'tools.inane.cherry', 'cherry-settings.json'), join(data, 'com.cherry.app', 'cherry-settings.json'),
      join(home, '.var', 'app', 'tools.inane.cherry', 'data', 'tools.inane.cherry', 'cherry-settings.json'),
      join(home, '.var', 'app', 'tools.inane.cherry', 'data', 'com.cherry.app', 'cherry-settings.json'),
      join(data, 'com.xylo.app', 'xylo-settings.json')];
  }
  return [join(appData, 'com.cherry.app', 'cherry-settings.json')];
}

async function sourceBytes(path) {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('The settings file must be smaller than 8 MB.');
    // A bounded read also covers a source file growing after stat().
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_BYTES) throw new Error('The settings file must be smaller than 8 MB.');
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}
async function optional(path) {
  try { return await readFile(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

const files = ['settings.json', 'auth.encrypted', 'lastfm.encrypted', 'tauri-migration.json'];
const pendingName = 'tauri-migration-pending.json';
async function atomicFile(profile, name, bytes, replace = rename) {
  const temp = join(profile, name + '.migration.tmp');
  await writeFile(temp, bytes, { mode: 0o600 });
  if (!(await readFile(temp)).equals(Buffer.from(bytes))) throw new Error('Import verification failed.');
  await replace(temp, join(profile, name));
  if (!(await readFile(join(profile, name))).equals(Buffer.from(bytes))) throw new Error('Import verification failed.');
}
async function restoreBackup(profile, backup, manifest) {
  // Verify all backup files before changing any destination files.
  const originals = new Map();
  if (!Array.isArray(manifest.files) || manifest.files.length !== files.length) throw new Error('Invalid migration backup.');
  for (const name of files) {
    const entry = manifest.files.find(item => item.name === name);
    if (!entry || typeof entry.existed !== 'boolean') throw new Error('Invalid migration backup.');
    const bytes = entry.existed ? await readFile(join(backup, name)) : null;
    if (bytes !== null && hash(bytes) !== entry.hash) throw new Error('Migration backup verification failed.');
    originals.set(name, bytes);
  }
  // Restore the old commit marker first. An interruption during rollback must
  // never be mistaken for a successfully committed import on the next launch.
  for (const name of ['tauri-migration.json', ...files.filter(name => name !== 'tauri-migration.json')]) {
    const bytes = originals.get(name);
    if (bytes === null) await rm(join(profile, name), { force: true });
    else await atomicFile(profile, name, bytes);
  }
}

/** Recover an interrupted multi-file transaction before the app restores auth/settings. */
export async function recoverMigration(profile) {
  const raw = await optional(join(profile, pendingName));
  if (raw === null) return false;
  let pending;
  try { pending = JSON.parse(raw.toString()); } catch { throw new Error('The migration recovery record is damaged.'); }
  if (pending?.version !== 1 || typeof pending.transaction !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(pending.transaction)) throw new Error('Invalid migration recovery record.');
  const backup = join(profile, 'migration-backups', pending.transaction);
  let completed;
  try { completed = JSON.parse((await optional(join(profile, 'tauri-migration.json')))?.toString() ?? 'null'); } catch { /* restore the previous marker too */ }
  if (completed?.transaction !== pending.transaction) {
    const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8'));
    await restoreBackup(profile, backup, manifest);
  }
  await rm(join(profile, pendingName), { force: true });
  for (const name of [...files, pendingName]) await rm(join(profile, name + '.migration.tmp'), { force: true });
  return true;
}

/** Disk-only importer. Caller serializes this with normal settings writes and restarts after success. */
export function createMigration({ profile, candidates, chooseFile, credentials, replace = rename, now = Date.now }) {
  let preview;
  let busy = false;
  let committed = false;
  return {
    async inspect({ accepted, pick = false } = {}) {
      if (accepted !== true) throw new Error('Accept the disclaimer before importing data.');
      if (busy || committed) throw new Error('Restart Cherry to finish importing data.');
      if (pick !== true && pick !== false) throw new Error('Invalid file selection.');
      const selected = pick ? await chooseFile() : null;
      if (pick && !selected) return null;
      preview = undefined;
      const paths = pick ? [selected] : candidates;
      const warnings = [];
      for (const path of paths) {
        let bytes;
        try { bytes = await sourceBytes(path); }
        catch (error) {
          if (pick) throw new Error(error.code ? 'The selected settings file could not be read.' : error.message);
          if (error.code !== 'ENOENT') warnings.push('A previous settings file could not be read. Choose a file manually.');
          continue;
        }
        let parsed;
        try { parsed = parseLegacySettings(bytes); }
        catch (error) { if (pick) throw error; warnings.push(error.message); continue; }
        const fingerprint = hash(bytes);
        preview = { token: randomUUID(), path, fingerprint, expires: now() + 10 * 60 * 1000 };
        const last = await optional(join(profile, 'tauri-migration.json'));
        let alreadyImported = false;
        try { alreadyImported = JSON.parse(last?.toString() ?? 'null')?.sourceHash === fingerprint; } catch { /* damaged marker doesn't block explicit import */ }
        return { found: true, token: preview.token, source: path, pins: parsed.settings.pinnedPlaylists?.length ?? 0,
          folders: parsed.settings.playlistFolders?.length ?? 0, preferences: Object.keys(parsed.settings).length,
          skipped: parsed.skipped, alreadyImported, warnings,
          credentialsSupported: !!credentials?.supported, credentialsReady: !!credentials?.supported && credentials.available() };
      }
      return { found: false, warnings };
    },
    async import({ accepted, token, includeCredentials = false } = {}) {
      if (accepted !== true) throw new Error('Accept the disclaimer before importing data.');
      if (busy || committed) throw new Error('An import is already in progress or waiting for restart.');
      if (!preview || token !== preview.token || now() > preview.expires) throw new Error('Inspect the settings file again before importing.');
      if (typeof includeCredentials !== 'boolean') throw new Error('Invalid credential selection.');
      busy = true;
      const source = preview;
      preview = undefined; // Single use, including failures. Retry requires a fresh preview.
      let backup;
      let transactionStarted = false;
      try {
        const bytes = await sourceBytes(source.path);
        if (hash(bytes) !== source.fingerprint) throw new Error('The Tauri file changed. Inspect it again before importing.');
        const { settings: legacy } = parseLegacySettings(bytes);
        await mkdir(profile, { recursive: true });
        if (await optional(join(profile, pendingName))) throw new Error('An earlier import needs recovery. Restart Cherry before importing again.');
        const originals = new Map(await Promise.all(files.map(async name => [name, await optional(join(profile, name))])));
        const original = originals.get('settings.json');
        let current = {};
        try { current = original ? JSON.parse(original.toString()) : {}; } catch { throw new Error('The Electron settings file is damaged. Import was cancelled without changing it.'); }
        if (!object(current)) throw new Error('The Electron settings file is invalid.');
        if (current.lastfmApiSecret || current.lastfmSessionKey) throw new Error('Restart Cherry so its existing Last.fm credentials can be secured before importing.');
        const merged = mergeLegacySettings(legacy, current);
        const outputs = new Map();
        const authExists = originals.get('auth.encrypted') !== null;
        const lastfmExists = originals.get('lastfm.encrypted') !== null;
        const status = { youtube: authExists ? 'kept' : 'skipped', lastfm: lastfmExists ? 'kept' : 'skipped' };
        if (authExists) {
          if (Object.hasOwn(current, 'channelPageId')) merged.channelPageId = current.channelPageId;
          else delete merged.channelPageId;
        }
        if (lastfmExists) {
          for (const key of Object.keys(merged)) if (key.startsWith('lastfm')) delete merged[key];
          for (const [key, value] of Object.entries(current)) if (key.startsWith('lastfm')) merged[key] = value;
        }
        if (includeCredentials) {
          if (!credentials?.supported) throw new Error('Credential migration currently supports Windows and Linux.');
          if (!credentials.available()) throw new Error('Secure storage is unavailable. Unlock your OS keyring and restart Cherry, or turn off sign-in import.');
          const imported = !authExists || !lastfmExists ? await credentials.read({ auth: !authExists, lastfm: !lastfmExists }) : {};
          status.youtube = authExists ? 'kept' : imported.auth ? 'imported' : 'not-found';
          // Very old versions stored Last.fm keys in settings. Encrypt them too;
          // never copy the legacy JSON into a backup or the new settings file.
          const lastfm = lastfmExists ? null : imported.lastfm ?? parseLegacyLastfm(JSON.parse(bytes.toString()).settings);
          status.lastfm = lastfmExists ? 'kept' : lastfm ? 'imported' : 'not-found';
          for (const [name, value] of [['auth.encrypted', !authExists && imported.auth], ['lastfm.encrypted', lastfm]]) {
            if (!value) continue;
            // lastfm is a JSON string inside secretRead's JSON envelope, matching secret_save.
            const plaintext = JSON.stringify(name === 'lastfm.encrypted' ? JSON.stringify(value) : value);
            const encrypted = credentials.encrypt(plaintext);
            if (credentials.decrypt(encrypted) !== plaintext) throw new Error('Credential encryption verification failed.');
            outputs.set(name, encrypted);
          }
        }
        outputs.set('settings.json', Buffer.from(JSON.stringify(merged)));
        const transaction = randomUUID();
        backup = join(profile, 'migration-backups', transaction);
        await mkdir(backup, { recursive: true, mode: 0o700 });
        const metadata = { version: 1, transaction, sourceHash: source.fingerprint, importedAt: new Date(now()).toISOString(), hadSettings: original !== null,
          files: files.map(name => ({ name, existed: originals.get(name) !== null, ...(originals.get(name) !== null ? { hash: hash(originals.get(name)) } : {}) })) };
        for (const [name, value] of originals) if (value !== null) {
          await writeFile(join(backup, name), value, { mode: 0o600, flag: 'wx' });
          if (!(await readFile(join(backup, name))).equals(value)) throw new Error('Backup verification failed.');
        }
        await writeFile(join(backup, 'manifest.json'), JSON.stringify(metadata, null, 2), { mode: 0o600, flag: 'wx' });
        await atomicFile(profile, pendingName, JSON.stringify({ version: 1, transaction }));
        transactionStarted = true;
        for (const [name, value] of outputs) await atomicFile(profile, name, value, replace);
        await atomicFile(profile, 'tauri-migration.json', JSON.stringify({ ...metadata, backup }), replace);
        await rm(join(profile, pendingName), { force: true });
        committed = true;
        return { backup, pins: merged.pinnedPlaylists.length, folders: merged.playlistFolders.length, credentials: status };
      } catch (error) {
        if (transactionStarted) {
          try {
            // Force rollback even if writing the commit marker succeeded but a
            // later verification failed. Startup recovery handles process exits.
            const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8'));
            await restoreBackup(profile, backup, manifest);
            await rm(join(profile, pendingName), { force: true });
          } catch {
            committed = true; // Freeze stale writes even if restoration failed.
            throw new Error('Import could not be restored automatically. Close Cherry; recovery will be retried on launch. Backup: ' + backup);
          }
        }
        // Filesystem errors can include paths, but never file contents or secrets.
        throw new Error(error.code ? `Import could not finish (${error.code}). Check file permissions and available disk space, then inspect the file again.` : error.message);
      } finally {
        busy = false;
        for (const name of [...files, pendingName]) await rm(join(profile, name + '.migration.tmp'), { force: true }).catch(() => {});
      }
    },
    get committed() { return committed; },
  };
}
