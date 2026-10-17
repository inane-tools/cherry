import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createUpdates, updateEnvironment } from './updates.mjs';
function fixture() {
  const engine = new EventEmitter(); const events = []; let flushed = 0, installed = 0;
  engine.checkForUpdates = async () => { engine.emit('update-available', { version: '1.7.2', releaseNotes: 'Fixes' }); };
  engine.downloadUpdate = async () => { engine.emit('download-progress', { total: 100, transferred: 50 }); engine.emit('update-downloaded', { version: '1.7.2' }); };
  engine.quitAndInstall = (silent, restart) => { assert.equal(silent, true); assert.equal(restart, true); assert.equal(flushed, 1); installed++; };
  const updates = createUpdates({ environment: 'windows', loadUpdater: async () => engine, emit: s => events.push(s), beforeInstall: async () => { flushed++; } });
  return { engine, updates, events, installed: () => installed };
}
test('only packaged Windows and real AppImages self-update; Flatpak never does', () => {
  assert.equal(updateEnvironment({ packaged: true, platform: 'win32' }), 'windows');
  assert.equal(updateEnvironment({ packaged: true, platform: 'linux', env: { APPIMAGE: '/app' } }), 'appimage');
  assert.equal(updateEnvironment({ packaged: true, platform: 'linux', env: { FLATPAK_ID: 'app', APPIMAGE: '/app' } }), 'flatpak');
  assert.equal(updateEnvironment({ packaged: false, platform: 'win32' }), 'development');
  assert.equal(updateEnvironment({ packaged: true, smoke: true, platform: 'win32' }), 'development');
  assert.equal(updateEnvironment({ packaged: true, platform: 'darwin' }), 'manual');
});
test('check, opt-in download progress and explicit silent install flush state first', async () => {
  const f = fixture();
  await assert.rejects(f.updates.install(), /Download/);
  await f.updates.check();
  assert.equal(f.engine.autoDownload, false); assert.equal(f.engine.autoInstallOnAppQuit, false);
  assert.equal(f.engine.allowDowngrade, false); assert.equal(f.engine.allowPrerelease, false);
  assert.equal(f.updates.state().phase, 'available');
  assert.equal(f.installed(), 0);
  await f.updates.download();
  assert.ok(f.events.some(s => s.phase === 'downloading' && s.received === 50));
  assert.equal(f.updates.state().phase, 'ready');
  await f.updates.check(); // rechecking does not lose the downloaded update
  assert.equal(f.updates.state().phase, 'ready');
  await f.updates.install(); assert.equal(f.installed(), 1);
});
test('coalesces concurrent checks and allows retry after network/download failure', async () => {
  const f = fixture(); let calls = 0, release;
  f.engine.checkForUpdates = async () => { calls++; await new Promise(r => { release = r; }); f.engine.emit('update-available', { version: '1.7.2' }); };
  const first = f.updates.check(), second = f.updates.check();
  await new Promise(r => setTimeout(r, 0)); release(); await Promise.all([first, second]); assert.equal(calls, 1);
  f.engine.downloadUpdate = async () => { throw Error('Network disconnected'); };
  await f.updates.download(); assert.equal(f.updates.state().phase, 'error');
  assert.equal(f.updates.state().version, '1.7.2');
  f.engine.downloadUpdate = async () => f.engine.emit('update-downloaded', { version: '1.7.2' });
  await f.updates.download(); assert.equal(f.updates.state().phase, 'ready');
});
test('managed/development installs never load an updater or offer executable installation', async () => {
  for (const environment of ['flatpak', 'development', 'manual']) {
    const updates = createUpdates({ environment, loadUpdater: () => { throw Error('must not run'); }, emit: () => {} });
    await updates.check(); assert.equal(updates.state().phase, 'idle');
    assert.throws(() => updates.download(), /Check/); await assert.rejects(updates.install());
  }
});
test('failed pre-install flush keeps the downloaded update retryable', async () => {
  const engine = new EventEmitter(); engine.checkForUpdates = async () => engine.emit('update-available', { version: '2.0.0' });
  engine.downloadUpdate = async () => engine.emit('update-downloaded', { version: '2.0.0' });
  engine.quitAndInstall = () => { throw Error('must not run'); };
  const updates = createUpdates({ environment: 'windows', loadUpdater: async () => engine, emit: () => {}, beforeInstall: async () => { throw Error('Disk busy'); } });
  await updates.check(); await updates.download(); await updates.install();
  assert.equal(updates.state().phase, 'ready'); assert.equal(updates.state().error, 'Disk busy');
});

test('a failed recheck does not discard an already downloaded installer', async () => {
  const f = fixture(); await f.updates.check(); await f.updates.download();
  f.engine.checkForUpdates = async () => { throw Error('Offline'); };
  await f.updates.check(); assert.equal(f.updates.state().phase, 'ready');
  assert.equal(f.updates.state().version, '1.7.2'); assert.match(f.updates.state().error, /Offline/);
  await f.updates.install(); assert.equal(f.installed(), 1);
});
