import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createMigration, parseLegacySettings, mergeLegacySettings, legacySettingsPaths, recoverMigration } from './migration.mjs';

const encode = settings => Buffer.from(JSON.stringify({ settings }));
const pin = (id, title = id) => ({ browseId: id, title });
const authFixture = { kind: 'cookie', cookie: 'SAPISID=fixture-only-not-a-real-cookie; SID=fixture', savedAt: 123 };

test('imports pins into their original channel without merging different brand accounts', () => {
  const current = { channelPageId: 'brand-b', pinnedPlaylistsByChannel: { 'channel:brand-b': [pin('same', 'B title')] } };
  const result = mergeLegacySettings({ channelPageId: 'brand-a', pinnedPlaylists: [pin('same', 'A title'), pin('old')] }, current);
  assert.deepEqual(result.pinnedPlaylistsByChannel['channel:brand-a'], [pin('same', 'A title'), pin('old')]);
  assert.deepEqual(result.pinnedPlaylistsByChannel['channel:brand-b'], [pin('same', 'B title')]);
  const fresh = mergeLegacySettings({ channelPageId: 'brand-a', pinnedPlaylists: [pin('old')] }, {});
  assert.deepEqual(fresh.pinnedPlaylistsByChannel, { 'channel:brand-a': [pin('old')] });
});
function credentialFixture(options = {}) {
  return { supported: true, available: () => true,
    read: async () => ({ auth: authFixture, lastfm: { lastfmApiSecret: 'api-fixture-secret', lastfmSessionKey: 'session-fixture-secret' } }),
    // Deliberately fake encryption for isolated fixtures; production injects safeStorage.
    encrypt: text => Buffer.from('sealed-test:' + Buffer.from(text).toString('base64')),
    decrypt: bytes => Buffer.from(bytes.toString().slice('sealed-test:'.length), 'base64').toString(), ...options };
}
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cherry-migration-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'cherry-settings.json');
  const profile = join(root, 'electron');
  await mkdir(profile);
  await writeFile(source, encode({ theme: 'light', volume: 0.4, pinnedPlaylists: [pin('legacy')], playlistFolders: [{ id: 'f', name: 'Music', playlistIds: ['legacy'] }] }));
  const importer = createMigration({ profile, candidates: [source], chooseFile: async () => source, ...options });
  return { root, source, profile, importer };
}

test('accepts known Tauri fields but never credentials, prototype keys or developer switches', () => {
  const input = JSON.parse('{"theme":"dark","__proto__":{"polluted":true}}');
  Object.assign(input, { lastfmApiSecret: 'SECRET', lastfmSessionKey: 'SESSION', cookie: 'COOKIE', developerUnlocked: true,
    devToolsEnabled: true, volume: 9, videoQuality: '1080', accentColor: 'url(unsafe)',
    pinnedPlaylists: [{ ...pin('p'), dangerous: 'hidden', thumbnail: 'https://i.ytimg.com/cover.jpg' }] });
  const result = parseLegacySettings(encode(input));
  assert.deepEqual(result.settings, { theme: 'dark', videoQuality: '1080', pinnedPlaylists: [{ ...pin('p'), thumbnail: 'https://i.ytimg.com/cover.jpg' }] });
  assert.equal(result.skipped, 2);
  assert.equal({}.polluted, undefined);
  for (const invalid of [Buffer.from('{broken'), Buffer.from('{"theme":"dark"}'), encode({ theme: [] }), encode({ pinnedPlaylists: [{ browseId: null }] })]) {
    assert.throws(() => parseLegacySettings(invalid));
  }
});

test('merges pins and folders without duplicates while preserving Electron edits and credentials', () => {
  const existing = { theme: 'dark', devToolsEnabled: false, pinnedPlaylists: [pin('same', 'Renamed'), pin('new')],
    playlistFolders: [{ id: 'existing', name: 'Electron', playlistIds: ['song'] }], sidebarOrder: ['existing'], collapsedFolders: ['existing'] };
  const incoming = { theme: 'light', pinnedPlaylists: [pin('same', 'Old'), pin('legacy')],
    playlistFolders: [{ id: 'legacy', name: 'Tauri', playlistIds: ['song', 'other'] }], sidebarOrder: ['legacy', 'existing'] };
  const merged = mergeLegacySettings(incoming, existing);
  assert.equal(merged.theme, 'light');
  assert.deepEqual(merged.pinnedPlaylists, [pin('same', 'Renamed'), pin('legacy'), pin('new')]);
  assert.deepEqual(merged.playlistFolders, [{ id: 'legacy', name: 'Tauri', playlistIds: ['other'] }, existing.playlistFolders[0]]);
  assert.deepEqual(merged.sidebarOrder, ['legacy', 'existing']);
  assert.equal(merged.devToolsEnabled, false);
  assert.deepEqual(existing.playlistFolders[0].playlistIds, ['song']);
});

test('does not inspect, choose or import until disclaimer accepted; previews contain no settings/secrets', async t => {
  let chooses = 0;
  const { importer } = await fixture(t, { chooseFile: async () => { chooses++; return null; } });
  await assert.rejects(importer.inspect({ pick: true }), /Accept/);
  await assert.rejects(importer.import({ token: 'fake' }), /Accept/);
  assert.equal(chooses, 0);
  const preview = await importer.inspect({ accepted: true });
  assert.equal(preview.pins, 1); assert.equal(preview.folders, 1);
  assert.equal('settings' in preview, false);
  assert.equal(await importer.inspect({ accepted: true, pick: true }), null);
  assert.equal(chooses, 1);
  await assert.rejects(importer.import({ accepted: true, token: 'fake' }), /Inspect/);
});

test('imports once with a verified byte-identical destination backup and leaves Tauri/auth untouched', async t => {
  const { source, profile, importer } = await fixture(t);
  const original = Buffer.from('{ "theme": "dark", "pinnedPlaylists": [{"browseId":"new","title":"New"}] }');
  await writeFile(join(profile, 'settings.json'), original);
  await writeFile(join(profile, 'auth.encrypted'), 'ENCRYPTED AUTH');
  const originalSource = await readFile(source);
  const preview = await importer.inspect({ accepted: true });
  const result = await importer.import({ accepted: true, token: preview.token });
  assert.deepEqual(await readFile(join(result.backup, 'settings.json')), original);
  assert.deepEqual(await readFile(source), originalSource);
  assert.equal(await readFile(join(profile, 'auth.encrypted'), 'utf8'), 'ENCRYPTED AUTH');
  const imported = JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8'));
  assert.equal(imported.theme, 'light');
  assert.deepEqual(imported.pinnedPlaylists.map(p => p.browseId), ['legacy', 'new']);
  assert.equal(result.pins, 2);
  assert.equal(importer.committed, true);
  await assert.rejects(importer.import({ accepted: true, token: preview.token }), /restart/i);
  const next = createMigration({ profile, candidates: [source] });
  assert.equal((await next.inspect({ accepted: true })).alreadyImported, true);
});

test('a first-run import also records that no previous settings existed', async t => {
  const { profile, importer } = await fixture(t);
  const preview = await importer.inspect({ accepted: true });
  const { backup } = await importer.import({ accepted: true, token: preview.token });
  assert.equal(JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8')).hadSettings, false);
  assert.deepEqual(await readdir(backup), ['manifest.json']);
  assert.equal(JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')).volume, 0.4);
});

test('source changes, expired or reused previews cannot import stale data', async t => {
  let time = 0;
  const { source, profile, importer } = await fixture(t, { now: () => time });
  const original = '{"theme":"dark"}';
  await writeFile(join(profile, 'settings.json'), original);
  let preview = await importer.inspect({ accepted: true });
  await writeFile(source, encode({ theme: 'dark' }));
  await assert.rejects(importer.import({ accepted: true, token: preview.token }), /changed/);
  await assert.rejects(importer.import({ accepted: true, token: preview.token }), /Inspect/);
  assert.equal(await readFile(join(profile, 'settings.json'), 'utf8'), original);
  preview = await importer.inspect({ accepted: true }); time = 600001;
  await assert.rejects(importer.import({ accepted: true, token: preview.token }), /Inspect/);
});

test('a failure after settings replacement restores the prior settings and marker exactly', async t => {
  let replacements = 0;
  const { source, profile, importer } = await fixture(t, { replace: async (from, to) => {
    if (++replacements === 2) throw Object.assign(new Error('disk failure'), { code: 'EIO' });
    return rename(from, to);
  } });
  const original = '{ "theme" : "dark" }';
  const marker = '{"previous":"import"}';
  await writeFile(join(profile, 'settings.json'), original);
  await writeFile(join(profile, 'tauri-migration.json'), marker);
  const sourceBefore = await readFile(source);
  const preview = await importer.inspect({ accepted: true });
  await assert.rejects(importer.import({ accepted: true, token: preview.token }), /could not finish/);
  assert.equal(importer.committed, false);
  assert.equal(await readFile(join(profile, 'settings.json'), 'utf8'), original);
  assert.equal(await readFile(join(profile, 'tauri-migration.json'), 'utf8'), marker);
  assert.deepEqual(await readFile(source), sourceBefore);
  assert.equal((await readdir(profile)).some(name => name.endsWith('.tmp')), false);
  assert.equal((await importer.inspect({ accepted: true })).found, true);
});

test('a failed first-run import removes the replacement instead of leaving a partial profile', async t => {
  let replacements = 0;
  const { profile, importer } = await fixture(t, { replace: async (from, to) => {
    if (++replacements === 2) throw new Error('marker failure');
    return rename(from, to);
  } });
  const preview = await importer.inspect({ accepted: true });
  await assert.rejects(importer.import({ accepted: true, token: preview.token }), /marker failure/);
  await assert.rejects(readFile(join(profile, 'settings.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(profile, 'tauri-migration.json')), { code: 'ENOENT' });
});

test('invalid/missing/oversized automatic sources do not prevent manually selecting a valid file', async t => {
  const { root, source, profile } = await fixture(t);
  const invalid = join(root, 'invalid.json');
  await writeFile(invalid, 'x'.repeat(8 * 1024 * 1024 + 1));
  const importer = createMigration({ profile, candidates: [join(root, 'missing'), invalid], chooseFile: async () => source });
  const preview = await importer.inspect({ accepted: true });
  assert.equal(preview.found, false); assert.equal(preview.warnings.length, 1);
  assert.equal((await importer.inspect({ accepted: true, pick: true })).found, true);
  const badPicker = createMigration({ profile, candidates: [], chooseFile: async () => invalid });
  await assert.rejects(badPicker.inspect({ accepted: true, pick: true }), /8 MB/);
});

test('detects Windows, Linux and Flatpak settings without depending on the current platform path style', () => {
  assert.deepEqual(legacySettingsPaths({ platform: 'win32', appData: '/roaming', home: '/home' }), [join('/roaming', 'com.cherry.app', 'cherry-settings.json'), join('/roaming', 'com.xylo.app', 'xylo-settings.json')]);
  const linux = legacySettingsPaths({ platform: 'linux', appData: '/unused', home: '/home/user', env: { XDG_DATA_HOME: '/custom-data' } });
  assert.equal(linux[0], join('/custom-data', 'tools.inane.cherry', 'cherry-settings.json'));
  assert.ok(linux.includes(join('/home/user', '.var', 'app', 'tools.inane.cherry', 'data', 'tools.inane.cherry', 'cherry-settings.json')));
});

test('imports YouTube/Last.fm through verified encryption without plaintext files or secret-bearing results', async t => {
  const credentials = credentialFixture();
  const { source, profile, importer } = await fixture(t, { credentials });
  await writeFile(source, encode({ theme: 'dark', lastfmApiKey: 'public-api-key', lastfmUsername: 'Fixture', lastfmEnabled: true,
    lastfmApiSecret: 'old-plaintext-secret', lastfmSessionKey: 'old-plaintext-session' }));
  const preview = await importer.inspect({ accepted: true });
  assert.equal(preview.credentialsReady, true);
  const result = await importer.import({ accepted: true, token: preview.token, includeCredentials: true });
  assert.deepEqual(result.credentials, { youtube: 'imported', lastfm: 'imported' });
  assert.deepEqual(JSON.parse(credentials.decrypt(await readFile(join(profile, 'auth.encrypted')))), authFixture);
  assert.deepEqual(JSON.parse(JSON.parse(credentials.decrypt(await readFile(join(profile, 'lastfm.encrypted'))))), { lastfmApiSecret: 'api-fixture-secret', lastfmSessionKey: 'session-fixture-secret' });
  const settings = await readFile(join(profile, 'settings.json'), 'utf8');
  assert.equal(JSON.parse(settings).lastfmApiKey, 'public-api-key');
  for (const name of await readdir(profile)) {
    if (name === 'migration-backups') continue;
    const content = await readFile(join(profile, name), 'utf8');
    assert.equal(content.includes('fixture-secret'), false);
    assert.equal(content.includes('old-plaintext'), false);
    assert.equal(content.includes(authFixture.cookie), false);
  }
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.deepEqual(await readdir(result.backup), ['manifest.json']);
});

test('keeps existing Electron accounts and associated Last.fm/API/channel settings without reading legacy secrets', async t => {
  let reads = 0;
  const { source, profile, importer } = await fixture(t, { credentials: credentialFixture({ read: async () => { reads++; throw Error('must not read'); } }) });
  await writeFile(join(profile, 'auth.encrypted'), 'existing-auth');
  await writeFile(join(profile, 'lastfm.encrypted'), 'existing-lastfm');
  await writeFile(join(profile, 'settings.json'), JSON.stringify({ theme: 'dark', channelPageId: 'electron-channel', lastfmApiKey: 'electron-api', lastfmUsername: 'Electron', lastfmEnabled: true }));
  await writeFile(source, encode({ theme: 'light', channelPageId: 'tauri-channel', lastfmApiKey: 'tauri-api', lastfmUsername: 'Tauri', lastfmEnabled: false }));
  const preview = await importer.inspect({ accepted: true });
  const result = await importer.import({ accepted: true, token: preview.token, includeCredentials: true });
  assert.equal(reads, 0);
  assert.deepEqual(result.credentials, { youtube: 'kept', lastfm: 'kept' });
  assert.equal(await readFile(join(profile, 'auth.encrypted'), 'utf8'), 'existing-auth');
  assert.equal(await readFile(join(profile, 'lastfm.encrypted'), 'utf8'), 'existing-lastfm');
  const settings = JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8'));
  assert.equal(settings.theme, 'light'); assert.equal(settings.channelPageId, 'electron-channel');
  assert.equal(settings.lastfmApiKey, 'electron-api'); assert.equal(settings.lastfmUsername, 'Electron'); assert.equal(settings.lastfmEnabled, true);
  assert.equal(await readFile(join(result.backup, 'auth.encrypted'), 'utf8'), 'existing-auth');
});

test('secures legacy plaintext Last.fm credentials when the old keyring entry is absent', async t => {
  const credentials = credentialFixture({ read: async () => ({ auth: null, lastfm: null }) });
  const { source, profile, importer } = await fixture(t, { credentials });
  await writeFile(source, encode({ theme: 'dark', lastfmApiSecret: 'old-secret', lastfmSessionKey: 'old-session' }));
  const preview = await importer.inspect({ accepted: true });
  const result = await importer.import({ accepted: true, token: preview.token, includeCredentials: true });
  assert.deepEqual(result.credentials, { youtube: 'not-found', lastfm: 'imported' });
  assert.deepEqual(JSON.parse(JSON.parse(credentials.decrypt(await readFile(join(profile, 'lastfm.encrypted'))))), { lastfmApiSecret: 'old-secret', lastfmSessionKey: 'old-session' });
  assert.equal((await readFile(join(profile, 'settings.json'), 'utf8')).includes('old-secret'), false);
});

test('unavailable encryption or failed credential reads abort before any profile writes', async t => {
  for (const credentials of [credentialFixture({ available: () => false }), credentialFixture({ read: async () => { throw Error('Unlock your keyring'); } }), credentialFixture({ decrypt: () => 'mismatch' })]) {
    const { profile, importer } = await fixture(t, { credentials });
    const preview = await importer.inspect({ accepted: true });
    await assert.rejects(importer.import({ accepted: true, token: preview.token, includeCredentials: true }));
    assert.deepEqual(await readdir(profile), []);
  }
});

test('failure during a credential transaction rolls back all files, not only preferences', async t => {
  let writes = 0;
  const { profile, importer } = await fixture(t, { credentials: credentialFixture(), replace: async (from, to) => {
    if (++writes === 3) throw Error('write failed');
    await rename(from, to);
  } });
  await writeFile(join(profile, 'settings.json'), '{"theme":"dark"}');
  const preview = await importer.inspect({ accepted: true });
  await assert.rejects(importer.import({ accepted: true, token: preview.token, includeCredentials: true }), /write failed/);
  assert.equal(await readFile(join(profile, 'settings.json'), 'utf8'), '{"theme":"dark"}');
  await assert.rejects(readFile(join(profile, 'auth.encrypted')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(profile, 'lastfm.encrypted')), { code: 'ENOENT' });
  assert.equal(await recoverMigration(profile), false);
});

test('a process interruption rolls back an uncommitted import on startup, while committed data survives', async t => {
  for (const phase of ['settings.json', 'tauri-migration.json']) {
    const { source, profile } = await fixture(t);
    await writeFile(join(profile, 'settings.json'), '{"theme":"dark"}');
    // This child only sees synthetic files and injected fake credentials. Exit
    // after an atomic replacement simulates losing the process mid-transaction.
    const script = `
      import { createMigration } from ${JSON.stringify(new URL('./migration.mjs', import.meta.url).href)};
      import { rename } from 'node:fs/promises';
      import { basename } from 'node:path';
      const [profile, source, phase] = process.argv.slice(1);
      const importer = createMigration({ profile, candidates: [source], credentials: {
        supported: true, available: () => true,
        read: async () => ({ auth: { kind: 'cookie', cookie: 'synthetic-only' }, lastfm: { lastfmApiSecret: 'synthetic' } }),
        encrypt: value => Buffer.from(value).reverse(), decrypt: value => Buffer.from(value).reverse().toString()
      }, replace: async (from, to) => { await rename(from, to); if (basename(to) === phase) process.exit(17); } });
      const preview = await importer.inspect({ accepted: true });
      await importer.import({ accepted: true, token: preview.token, includeCredentials: true });
    `;
    await assert.rejects(promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, profile, source, phase]), { code: 17 });
    assert.equal(await recoverMigration(profile), true);
    const after = JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8'));
    if (phase === 'settings.json') {
      assert.deepEqual(after, { theme: 'dark' });
      await assert.rejects(readFile(join(profile, 'auth.encrypted')), { code: 'ENOENT' });
    } else {
      assert.equal(after.theme, 'light');
      assert.ok((await readFile(join(profile, 'auth.encrypted'))).length > 0);
    }
    assert.equal(await recoverMigration(profile), false);
  }
});
