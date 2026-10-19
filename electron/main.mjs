import { app, BrowserWindow, ipcMain, protocol, net, shell, safeStorage, session, Menu, Tray, nativeImage, nativeTheme, dialog } from 'electron';
import { installTextMenu } from './text-menu.mjs';
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assetPath, trustedRenderer, externalUrl, fullscreenPermission } from './policy.mjs';
import { fetchAllowed, apiHeaders, createMediaFetch } from './network.mjs';
import { captureYouTubeSession, createAuthPersistence } from './login.mjs';
import { createDiscordPresence } from './discord.mjs';
import { createLastfm } from './lastfm.mjs';
import { createTaskbarControls } from './taskbar.mjs';
import { createPlaylistImageUpload } from './playlist-image.mjs';
import { createJumpLists, createPlaylistLaunch, playlistArgument } from './jump-list.mjs';
import { createUpdates, updateEnvironment } from './updates.mjs';
import { profileSize, cleanupSteps, clearSessionCaches } from './maintenance.mjs';
import { prepareWindowsIdentity } from './windows-identity.mjs';
import { createMigration, legacySettingsPaths, recoverMigration } from './migration.mjs';
import { createLegacyCredentialReader } from './legacy-credentials.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, 'assets');
const devUrl = process.env.CHERRY_DEV_URL;
const smoke = process.argv.includes('--smoke-test');
// Exercise light -> dark captions even when the developer's desktop is dark.
if (smoke) nativeTheme.themeSource = 'light';
if (devUrl && !/^http:\/\/127\.0\.0\.1:1423\/?$/.test(devUrl)) throw new Error('Invalid development origin');
app.setName('Cherry');
const appId = smoke ? 'tools.inane.cherry.electron.smoke' : 'tools.inane.cherry.electron';
app.setAppUserModelId(appId);
// Never reuse the released app's settings, cookies, updater state or keychain.
const profilePath = smoke ? process.env.CHERRY_SMOKE_PROFILE || join(app.getPath('temp'), 'cherry-electron-smoke-' + Date.now()) : join(app.getPath('appData'), 'cherry-electron');
app.setPath('userData', profilePath);
app.setPath('sessionData', profilePath);
if (smoke) process.env.CHERRY_SMOKE_PROFILE = profilePath;
protocol.registerSchemesAsPrivileged([
  { scheme: 'cherry', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'cherry-media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);
let window;
let login;
let tray;
let settings = {};
let resettingData = false;
let migratingData = false;
let writeChain = Promise.resolve();
const data = name => join(app.getPath('userData'), name);
const migration = createMigration({
  profile: profilePath,
  candidates: legacySettingsPaths({ platform: process.platform, appData: app.getPath('appData'), home: app.getPath('home') }),
  credentials: {
    supported: !smoke && ['win32', 'linux'].includes(process.platform),
    available: () => safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
    read: createLegacyCredentialReader({ helperPath: app.isPackaged
      ? join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'legacy-credentials.ps1')
      : join(here, 'legacy-credentials.ps1') }),
    encrypt: plaintext => safeStorage.encryptString(plaintext),
    decrypt: encrypted => safeStorage.decryptString(encrypted),
  },
  chooseFile: async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Choose Tauri Cherry settings',
      properties: ['openFile'], filters: [{ name: 'Cherry settings', extensions: ['json'] }] });
    return result.canceled ? null : result.filePaths[0];
  },
});
const send = (name, value) => { if (window && !window.isDestroyed()) window.webContents.send(name, value); };
const discord = createDiscordPresence();
const lastfm = createLastfm();
const fetchMedia = createMediaFetch((url, options) => net.fetch(url, options));
const updates = createUpdates({
  environment: updateEnvironment({ packaged: app.isPackaged, platform: process.platform, env: process.env, smoke }),
  loadUpdater: async () => { const { default: module } = await import('electron-updater'); return module.autoUpdater; },
  emit: state => send('updater-state', state),
  beforeInstall: async () => { await writeChain; await session.defaultSession.flushStorageData(); await discord.clear().catch(() => {}); },
});
const updateTaskbar = createTaskbarControls({ nativeImage, dispatch: id => send('tray://action', id) });
const uploadPlaylistImage = createPlaylistImageUpload({ userAgent: browserAgent });
const playlistLaunch = createPlaylistLaunch(process.argv, id => {
  if (!smoke) { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); }
  send('tray://action', 'open-playlist:' + id);
});
const jumpLists = createJumpLists({ app, nativeImage, directory: data('jump-artwork'), iconPath: data('branding/icon.ico') });
async function atomic(name, text) {
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(data(name + '.tmp'), text, { mode: 0o600 });
  await rename(data(name + '.tmp'), data(name));
}
function enqueueWrite(task) {
  const work = writeChain.then(task);
  writeChain = work.catch(() => {});
  return work;
}
async function secretRead(name) {
  try {
    const bytes = await readFile(data(name + '.encrypted'));
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable');
    return JSON.parse(safeStorage.decryptString(bytes));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function secretWrite(name, value) {
  return enqueueWrite(async () => {
    if (value === null || value === '') { await rm(data(name + '.encrypted'), { force: true }); return; }
    if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
      throw new Error('Secure OS storage is unavailable. Unlock/install a Secret Service keyring first.');
    }
    await atomic(name + '.encrypted', safeStorage.encryptString(JSON.stringify(value)));
  });
}
function permissions(ses) {
  const allowed = (contents, permission, details) => !!window && !window.isDestroyed() && contents === window.webContents
    && fullscreenPermission(permission, details, contents.getURL(), devUrl);
  ses.setPermissionRequestHandler((contents, permission, answer, details) => answer(allowed(contents, permission, details)));
  ses.setPermissionCheckHandler((contents, permission, origin, details) => allowed(contents, permission,
    { ...details, requestingUrl: details.requestingUrl ?? origin }));
}
async function boundedBytes(response, max = 32 * 1024 * 1024) {
  if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new Error('Response too large'); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > max) throw new Error('Response too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
const loginSession = () => session.fromPartition('persist:youtube-login');
let loginAttempt = false;
let loginGeneration = 0;
let loginContext = {};
const secureAuth = createAuthPersistence({
  available: () => safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
  read: () => secretRead('auth'), write: value => secretWrite('auth', value), clear: () => secretWrite('auth', null),
});
async function captureLoginContext() {
  if (!login || login.isDestroyed() || new URL(login.webContents.getURL() || 'about:blank').origin !== 'https://music.youtube.com') return;
  const generation = loginGeneration;
  let timeout;
  const value = await Promise.race([
    login.webContents.executeJavaScript("globalThis.ytcfg?.get ? ({ accountIndex: Number(globalThis.ytcfg.get('SESSION_INDEX') ?? 0), selectedChannelId: String(globalThis.ytcfg.get('DELEGATED_SESSION_ID') ?? '') }) : null"),
    new Promise(resolve => { timeout = setTimeout(() => resolve(null), 1000); }),
  ]).catch(() => null).finally(() => clearTimeout(timeout));
  if (generation === loginGeneration && value && Number.isInteger(value.accountIndex) && value.accountIndex >= 0) loginContext = value;
}
async function capturedSession() {
  await captureLoginContext();
  if (!Number.isInteger(loginContext.accountIndex)) throw new Error('Waiting for the YouTube Music account page to finish loading.');
  return captureYouTubeSession(loginSession().cookies, Date.now(), loginContext);
}
function cancelLogin() {
  loginGeneration++;
  loginAttempt = false;
  loginContext = {};
  // Destroy bypasses the normal close handler that captures a successful login.
  if (login && !login.isDestroyed()) login.destroy();
  login = undefined;
}
async function clearAuth() {
  cancelLogin();
  const result = await cleanupSteps([
    ['saved sign-in', () => secureAuth.clear()],
    ['login browser data', () => loginSession().clearData()],
    ['login HTTP credentials', () => loginSession().clearAuthCache()],
    ['login connections', () => loginSession().closeAllConnections()],
  ]);
  if (result.locked.length) throw new Error('Could not clear ' + result.locked.join(', ') + '. Try signing out again.');
}
function browserAgent() { return app.userAgentFallback.replace(/\s(?:Electron|Cherry[^ /]*)\/[^ ]+/g, ''); }
function openLogin() {
  if (resettingData) throw new Error('Restart Cherry to finish clearing data.');
  loginAttempt = true;
  if (login && !login.isDestroyed()) { login.focus(); return; }
  loginContext = {};
  const ses = loginSession(); permissions(ses);
  login = new BrowserWindow({ title: 'Sign in to YouTube Music', width: 1020, height: 780, parent: window,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const popup = login;
  const valid = value => { try { const u = new URL(value); return u.protocol === 'https:' && ['youtube.com', 'google.com'].some(host => u.hostname === host || u.hostname.endsWith('.' + host)); } catch { return false; } };
  login.webContents.on('will-navigate', (event, url) => { if (!valid(url)) event.preventDefault(); });
  login.webContents.on('will-redirect', (event, url) => { if (!valid(url)) event.preventDefault(); });
  login.webContents.setWindowOpenHandler(({ url }) => { if (valid(url)) void login.loadURL(url); return { action: 'deny' }; });
  let closing = false;
  login.webContents.on('did-finish-load', () => { void captureLoginContext(); });
  login.on('close', event => {
    if (closing) return;
    event.preventDefault(); closing = true;
    void captureLoginContext().finally(() => { if (!popup.isDestroyed()) popup.close(); });
  });
  login.on('closed', () => { if (login === popup) login = undefined; });
  void login.loadURL('https://music.youtube.com');
}
function updateTray(state) {
  updateTaskbar(window, state);
  const action = id => () => send('tray://action', id);
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(join(assets, 'icon.png')).resize({ width: 20, height: 20 }));
    tray.setToolTip('Cherry'); tray.on('click', () => { window?.show(); window?.focus(); });
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: state.playing ? 'Pause' : 'Play', enabled: !!state.hasTrack, click: action('toggle') },
    { label: 'Previous', enabled: !!state.hasTrack, click: action('prev') },
    { label: 'Next', enabled: !!state.hasTrack, click: action('next') },
    { label: 'Shuffle', type: 'checkbox', checked: !!state.shuffle, click: action('shuffle') },
    { label: 'Repeat', submenu: ['off', 'all', 'one'].map(mode => ({ label: mode, type: 'radio', checked: state.repeat === mode, click: action('repeat:' + mode) })) },
    ...((state.pinned ?? []).length ? [{ type: 'separator' }, ...(state.pinned ?? []).slice(0, 30).map(p => ({ label: String(p.title).replaceAll('&', '&&'), click: action('playlist:' + p.browseId) }))] : []),
    { type: 'separator' }, { label: 'Show Cherry', click: () => window?.show() }, { label: 'Quit', click: () => app.quit() },
  ]));
}
const commands = {
  ...(smoke ? {
    'smoke:zoom': () => window.webContents.getZoomFactor(),
    'smoke:dispatch': ({ action }) => send('tray://action', action),
    'smoke:second-instance': ({ legacy = false }) => promisify(execFile)(process.execPath, [...(!app.isPackaged ? [app.getAppPath()] : []), '--smoke-test', ...(legacy ? ['--open-playlist', 'VLSMOKE'] : ['--open-playlist=VLSMOKE'])], { windowsHide: true, timeout: 10000 }),
  } : {}),
  updater_state: () => updates.state(),
  updater_check: () => updates.check(),
  updater_download: () => updates.download(),
  updater_install: () => updates.install(),
  desktop_platform: () => process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  'window:minimize': () => window.minimize(),
  'window:close': () => window.close(),
  'window:toggle-maximize': () => window.isMaximized() ? window.unmaximize() : window.maximize(),
  'window:is-maximized': () => window.isMaximized(),
  'window:is-fullscreen': () => window.isFullScreen(),
  'window:title': ({ title }) => window.setTitle(String(title).slice(0, 300)),
  set_window_zoom: ({ scale }) => { if (!Number.isFinite(scale) || scale < .5 || scale > 3) throw new Error('Invalid zoom'); window.webContents.setZoomFactor(scale); },
  'settings:get': ({ key }) => { if (key !== 'settings') throw new Error('Unknown settings key'); return settings; },
  'settings:set': ({ key, value }) => { if (key !== 'settings' || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings'); return enqueueWrite(async () => { settings = value; await atomic('settings.json', JSON.stringify(settings)); }); },
  'app:relaunch': () => {
    if (migratingData && !migration.committed) throw new Error('Wait for the import to finish before restarting.');
    app.relaunch(); app.quit();
  },
  migration_inspect: args => migration.inspect(args),
  migration_import: args => {
    if (args.accepted !== true) throw new Error('Accept the disclaimer before importing data.');
    migratingData = true;
    cancelLogin();
    return enqueueWrite(() => migration.import(args)).finally(() => { migratingData = migration.committed; });
  },
  'app:open-url': ({ url }) => shell.openExternal(externalUrl(url)),
  open_devtools: () => window.webContents.openDevTools({ mode: 'detach' }),
  close_devtools: () => window.webContents.closeDevTools(),
  auth_load: () => secureAuth.load(),
  auth_save: ({ session: value }) => { if (value?.kind !== 'cookie' || typeof value.cookie !== 'string' || value.cookie.length > 100000) throw new Error('Invalid session'); return secureAuth.save(value); },
  auth_clear: clearAuth,
  secret_load: ({ name }) => { if (name !== 'lastfm') throw new Error('Unknown secret'); return secretRead('lastfm'); },
  secret_save: ({ name, value }) => { if (name !== 'lastfm' || typeof value !== 'string' || value.length > 100000) throw new Error('Invalid secret'); return secretWrite('lastfm', value); },
  open_ytm_login: openLogin,
  close_ytm_login: () => { loginAttempt = false; login?.close(); },
  ytm_login_status: async () => ({ open: !!login, url: login?.webContents.getURL() ?? '', loggedIn: loginAttempt && await capturedSession().then(() => true, () => false) }),
  ytm_login_finish: async () => {
    const generation = loginGeneration;
    if (!loginAttempt || resettingData) throw new Error('Sign-in was cancelled.');
    const captured = await capturedSession();
    if (generation !== loginGeneration || !loginAttempt) throw new Error('Sign-in was cancelled.');
    const value = await secureAuth.save(captured);
    await loginSession().cookies.flushStore();
    if (generation !== loginGeneration) throw new Error('Sign-in was cancelled.');
    login?.close(); loginAttempt = false; return value;
  },
  http_proxy_fetch: async ({ url, method = 'GET', headers = {}, body }) => {
    if (!['GET', 'POST', 'PUT', 'DELETE', 'HEAD'].includes(method) || (body && (typeof body !== 'string' || body.length > 20 * 1024 * 1024))) throw new Error('Invalid HTTP request');
    const clean = apiHeaders(url, headers, browserAgent());
    const response = await fetchAllowed(url, { method, headers: clean, body: body ?? undefined });
    const bytes = await boundedBytes(response);
    return { status: response.status, headers: Object.fromEntries(response.headers), body: bytes.toString('utf8') };
  },
  http_proxy_fetch_base64: async ({ url }) => (await boundedBytes(await fetchAllowed(url))).toString('base64'),
  cache_size: () => profileSize(profilePath),
  clear_cache: () => clearSessionCaches([['App', session.defaultSession], ['Login', loginSession()]]),
  clear_local_data: async () => {
    // Ignore subsequent stale renderer writes until relaunch, including queued
    // settings and secret saves. Existing writes finish before deletion.
    resettingData = true;
    cancelLogin();
    await writeChain;
    const result = await cleanupSteps([
      // Chromium clearData does not cover localStorage on our custom scheme.
      ['app browser data', async () => {
        await window.webContents.executeJavaScript('localStorage.clear(); sessionStorage.clear();');
        await session.defaultSession.clearStorageData();
        await session.defaultSession.clearData();
      }],
      ['login browser data', () => clearAuth()],
      ['Last.fm credentials', () => secretWrite('lastfm', null)],
      ['settings', () => enqueueWrite(async () => { settings = {}; await rm(data('settings.json'), { force: true }); })],
      ['migration backups', async () => {
        await rm(data('migration-backups'), { recursive: true, force: true });
        await rm(data('tauri-migration.json'), { force: true });
      }],
      ['Windows playlist shortcuts', () => jumpLists.update([], [])],
      ['shortcut artwork', () => rm(data('jump-artwork'), { recursive: true, force: true })],
      ['Discord presence', () => discord.clear()],
    ]);
    return [...result.removed, ...result.locked.map(name => 'locked:' + name)];
  },
  take_playlist_launch: () => playlistLaunch.take(),
  update_tray: ({ state }) => updateTray(state),
  update_jump_list: ({ pinned, recent }) => jumpLists.update(pinned, recent),
  jump_artwork_cached: ({ thumbnail }) => jumpLists.artworkCached(thumbnail),
  cache_jump_artwork: ({ thumbnail, pngBase64 }) => jumpLists.cacheArtwork(thumbnail, pngBase64),
  upload_playlist_thumbnail: args => uploadPlaylistImage(args),
  lastfm_get_token: args => lastfm.getToken(args),
  lastfm_get_session: args => lastfm.getSession(args),
  lastfm_now_playing: args => lastfm.nowPlaying(args),
  lastfm_scrobble: args => lastfm.scrobble(args),
  discord_set_app_id: ({ appId }) => discord.setAppId(appId),
  discord_status: () => discord.status(),
  discord_clear_presence: () => discord.clear(),
  discord_set_presence: ({ payload }) => discord.setPresence(payload),
};
async function main() {
  await app.whenReady();
  try { await recoverMigration(profilePath); }
  catch {
    dialog.showErrorBox('Cherry migration recovery', 'An interrupted import could not be restored. Close Cherry and restore the files in migration-backups inside ' + profilePath + ' before starting again.');
    app.quit(); return;
  }
  permissions(session.defaultSession);
  await prepareWindowsIdentity({ appId, assets, directory: data('branding'), register: !smoke }).catch(error => console.warn('[windows] Could not register app name/icon:', error.message));
  try { settings = JSON.parse(await readFile(data('settings.json'), 'utf8')); } catch { settings = {}; }
  protocol.handle('cherry', async request => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'app' || request.method !== 'GET') return new Response('Not found', { status: 404 });
      const response = await net.fetch(pathToFileURL(assetPath(join(here, '../dist'), url.pathname === '/' ? '/index.html' : url.pathname)).href);
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; font-src 'self' data:; media-src 'self' https: blob: cherry-media:; connect-src 'self' https: blob: cherry-media:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'");
      return new Response(response.body, { status: response.status, headers });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  protocol.handle('cherry-media', async request => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return new Response(null, { status: 405, headers: cors });
    try {
      const source = new URL(request.url).searchParams.get('url');
      const headers = new Headers(); const range = request.headers.get('range'); if (range) headers.set('range', range);
      headers.set('user-agent', browserAgent()); headers.set('accept-encoding', 'identity');
      const response = await fetchMedia(source, { headers, signal: request.signal });
      if (!response.ok) console.warn('[media] CDN returned HTTP ' + response.status);
      const output = new Headers(cors);
      for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (response.headers.has(name)) output.set(name, response.headers.get(name));
      return new Response(response.body, { status: response.status, headers: output });
    } catch { return new Response('Media request failed', { status: 502, headers: cors }); }
  });
  window = new BrowserWindow({ title: 'Cherry', width: 1280, height: 850, minWidth: 460, minHeight: 540,
    frame: false, show: false, backgroundColor: '#0a0a0f', icon: join(assets, 'icon.png'),
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: !smoke } });
  installTextMenu(window, Menu);
  if (process.platform === 'win32') window.setAppDetails({ appId, appIconPath: data('branding/icon.ico'), relaunchDisplayName: 'Cherry', relaunchCommand: [process.execPath, ...(!app.isPackaged ? [app.getAppPath()] : [])].map(value => '"' + value + '"').join(' ') });
  ipcMain.handle('desktop:invoke', async (event, command, args = {}) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !trustedRenderer(event.senderFrame.url, devUrl)) throw new Error('Untrusted IPC sender');
    if (!Object.hasOwn(commands, command)) throw new Error('Desktop feature not ported: ' + String(command));
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid command arguments');
    if (migratingData) {
      // The renderer still holds the pre-import settings. Ignore its delayed
      // saves until restart so an unrelated subscription cannot undo the import.
      if (['settings:set', 'secret_save', 'update_jump_list', 'cache_jump_artwork'].includes(command)) return;
      if (['migration_inspect', 'migration_import', 'auth_save', 'auth_clear', 'ytm_login_finish', 'open_ytm_login', 'clear_local_data', 'updater_check', 'updater_download', 'updater_install'].includes(command)) throw new Error('Restart Cherry to finish importing data.');
    }
    if (resettingData) {
      if (['settings:set', 'secret_save', 'update_jump_list', 'cache_jump_artwork'].includes(command)) return;
      if (['migration_inspect', 'migration_import', 'auth_save', 'ytm_login_finish', 'open_ytm_login', 'updater_check', 'updater_download', 'updater_install'].includes(command)) throw new Error('Restart Cherry to finish clearing data.');
      if (command === 'auth_load' || command === 'secret_load') return null;
    }
    return commands[command](args);
  });
  window.webContents.on('did-start-navigation', details => { if (details.isMainFrame && !details.isSameDocument) playlistLaunch.reset(); });
  window.webContents.on('render-process-gone', () => { playlistLaunch.reset(); void discord.clear().catch(() => {}); });
  window.webContents.on('will-navigate', (event, url) => { if (!trustedRenderer(url, devUrl)) event.preventDefault(); });
  window.webContents.setWindowOpenHandler(({ url }) => { try { void shell.openExternal(externalUrl(url)); } catch {} return { action: 'deny' }; });
  window.once('ready-to-show', () => { if (!smoke) window.show(); });
  window.on('resize', () => send('window-resized', null));
  window.on('focus', () => send('window-focus', true)); window.on('blur', () => send('window-focus', false));
  // Closing exits; there is intentionally no minimize-to-tray behavior.
  window.on('closed', () => { login?.close(); app.quit(); });
  if (devUrl) console.log('[desktop] Loading ' + devUrl);
  await window.loadURL(devUrl ?? 'cherry://app/index.html');
  // Some Windows launch configurations suppress the first native ShowWindow.
  // Reveal again after navigation instead of relying only on ready-to-show.
  if (!smoke) { window.show(); window.focus(); }
  // CI owns an isolated desktop. Let Chromium paint the test window there;
  // hidden/throttled server windows can retain stale native computed colors.
  else if (process.env.CI === 'true') window.showInactive();
  if (devUrl) console.log('[desktop] App loaded' + (smoke ? ' (hidden smoke test)' : ''));
  if (smoke) {
    await loginSession().cookies.set({ url: 'https://music.youtube.com/', name: 'SID', value: 'smoke-session-identity' });
    await loginSession().cookies.set({ url: 'https://www.youtube.com/', name: 'SAPISID', value: 'smoke-signing-cookie' });
    loginAttempt = true;
    loginContext = { accountIndex: 2, selectedChannelId: 'smoke-brand' };
    const smokeArtwork = nativeImage.createFromPath(join(assets, 'icon.png')).resize({ width: 64, height: 64 }).toPNG().toString('base64');
    if (process.platform === 'win32' && updateTaskbar(window, { hasTrack: true, playing: true }) !== true) throw new Error('Native taskbar toolbar rejected enabled buttons');
    const { testMediaTransport } = await import('./media-transport.smoke.mjs');
    await testMediaTransport((url, options) => net.fetch(url, options));
    const { default: updaterModule } = await import('electron-updater');
    if (typeof updaterModule.autoUpdater.checkForUpdates !== 'function') throw new Error('Packaged updater dependency missing');
    const errors = [];
    window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    const result = await window.webContents.executeJavaScript(`(async () => {
      const bridge = window.cherryDesktop;
      if (!bridge || typeof require !== 'undefined' || typeof process !== 'undefined') throw Error('Renderer isolation failed');
      for (let i = 0; i < 100 && !document.body.textContent.includes('Welcome to Cherry'); i++) await new Promise(r => setTimeout(r, 100));
      if (!document.body.textContent.includes('Welcome to Cherry')) throw Error('App did not mount');
      const actionProbe = [];
      const stopActionProbe = bridge.subscribe('tray://action', payload => actionProbe.push(payload));
      await bridge.invoke('smoke:dispatch', { action: 'probe' });
      await new Promise(resolve => setTimeout(resolve, 50));
      if (actionProbe[0] !== 'probe') throw Error('Native action event did not reach renderer');
      await bridge.invoke('smoke:second-instance');
      for (let i = 0; i < 50 && !actionProbe.includes('open-playlist:VLSMOKE'); i++) await new Promise(resolve => setTimeout(resolve, 20));
      if (!actionProbe.includes('open-playlist:VLSMOKE')) throw Error('Second-instance playlist launch was not delivered: ' + JSON.stringify(actionProbe));
      await bridge.invoke('smoke:second-instance', { legacy: true });
      for (let i = 0; i < 50 && actionProbe.filter(action => action === 'open-playlist:VLSMOKE').length < 2; i++) await new Promise(resolve => setTimeout(resolve, 20));
      if (actionProbe.filter(action => action === 'open-playlist:VLSMOKE').length !== 2) throw Error('Legacy playlist launch did not survive Chromium argument reordering');
      stopActionProbe();
      await bridge.invoke('smoke:dispatch', { action: 'shuffle' });
      for (let i = 0; i < 250 && !(await bridge.invoke('settings:get', { key: 'settings' })).shuffle; i++) await new Promise(resolve => setTimeout(resolve, 20));
      if (!(await bridge.invoke('settings:get', { key: 'settings' })).shuffle) throw Error('Native action did not reach the app action router');
      // DASH initializes from a generated Blob manifest in installed builds.
      const manifestProbe = URL.createObjectURL(new Blob(['<MPD/>'], { type: 'application/dash+xml' }));
      try {
        const manifestText = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest(); xhr.open('GET', manifestProbe);
          xhr.onload = () => resolve(xhr.responseText); xhr.onerror = () => reject(Error('Packaged CSP blocked the DASH manifest'));
          xhr.send();
        });
        if (manifestText !== '<MPD/>') throw Error('Packaged manifest load failed');
      } finally { URL.revokeObjectURL(manifestProbe); }
      const platform = await bridge.invoke('desktop_platform');
      const updateState = await bridge.invoke('updater_state');
      if (updateState.environment !== 'development' || (await bridge.invoke('updater_check')).phase !== 'idle') throw Error('Smoke profile attempted real updates');
      if (platform === 'windows') {
        const caption = document.querySelector('.win-caption');
        if (!caption || caption.querySelectorAll('.win-glyph').length !== 3) throw Error('Windows Segoe captions missing');
        const glyph = caption.querySelector('.win-glyph');
        if (glyph.textContent !== '\uE921' || !getComputedStyle(glyph).fontFamily.includes('Segoe')) throw Error('Incorrect native caption glyph');
        const root = document.documentElement;
        const wasLight = root.classList.contains('light');
        const wasDark = root.classList.contains('dark');
        // Exercise the same class pair as appearance.ts, allowing the renderer
        // to finish recalculating native colors on a fresh/headless Windows VM.
        async function checkCaptionTheme(light, expected) {
          root.classList.toggle('light', light);
          root.classList.toggle('dark', !light);
          const button = caption.querySelector('button');
          let actual;
          for (let i = 0; i < 25; i++) {
            actual = getComputedStyle(button).color;
            if (actual === expected) return;
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          const rules = [];
          function scanRules(list) {
            for (const rule of list) {
              if (rule.selectorText?.includes('win-caption')) rules.push(rule.cssText);
              if (rule.cssRules) scanRules(rule.cssRules);
            }
          }
          for (const sheet of document.styleSheets) { try { scanRules(sheet.cssRules); } catch {} }
          throw Error('Caption color mismatch: ' + JSON.stringify({ light, expected, actual, classes: root.className, captionClass: caption.className, connected: caption.isConnected, buttonMatches: button.matches('html:not(.light) .win-caption > button'), forcedColors: matchMedia('(forced-colors: active)').matches, rules, html: button.outerHTML, scheme: getComputedStyle(root).colorScheme }));
        }
        try {
          await checkCaptionTheme(true, 'rgb(0, 0, 0)');
          await checkCaptionTheme(false, 'rgb(255, 255, 255)');
        } finally {
          root.classList.toggle('light', wasLight);
          root.classList.toggle('dark', wasDark);
        }
        await bridge.invoke('set_window_zoom', { scale: 1.65 });
        if (Math.abs(await bridge.invoke('smoke:zoom') - 1.65) > .001) throw Error('Caption/app zoom mismatch');
        await bridge.invoke('set_window_zoom', { scale: 1.1 });
      }
      await bridge.invoke('settings:set', { key: 'settings', value: { lyricsEnabled: true, theme: 'dark' } });
      const settings = await bridge.invoke('settings:get', { key: 'settings' });
      if (!settings.lyricsEnabled) throw Error('Settings round trip failed');
      await bridge.invoke('secret_save', { name: 'lastfm', value: 'smoke-secret' });
      if (await bridge.invoke('secret_load', { name: 'lastfm' }) !== 'smoke-secret') throw Error('Encrypted secret round trip failed');
      const login = await bridge.invoke('ytm_login_status');
      if (!login.loggedIn || login.open) throw Error('Closed login cookie detection failed');
      const captured = await bridge.invoke('ytm_login_finish');
      if (!captured.cookie.includes('SID=smoke-session-identity') || !captured.cookie.includes('SAPISID=smoke-signing-cookie')) throw Error('Cookie capture incomplete');
      if (captured.accountIndex !== 2 || captured.selectedChannelId !== 'smoke-brand') throw Error('Account identity capture incomplete');
      if ((await bridge.invoke('auth_load')).cookie !== captured.cookie) throw Error('Captured auth was not persisted');
      await bridge.invoke('auth_clear');
      if (await bridge.invoke('auth_load')) throw Error('Logout retained saved auth');
      if ((await bridge.invoke('ytm_login_status')).loggedIn) throw Error('Logout retained login cookies');
      if (!(await bridge.invoke('discord_set_app_id', { appId: '' })).configured) throw Error('Discord configuration failed');
      await bridge.invoke('discord_clear_presence');
      await bridge.invoke('cache_jump_artwork', { thumbnail: 'smoke-artwork', pngBase64: ${JSON.stringify(smokeArtwork)} });
      if (!(await bridge.invoke('jump_artwork_cached', { thumbnail: 'smoke-artwork' }))) throw Error('Shortcut artwork round trip failed');
      const checkbox = document.querySelector('.cherry-gate input[type="checkbox"]');
      if (!checkbox) throw Error('Welcome acceptance control missing');
      checkbox.click(); await new Promise(resolve => setTimeout(resolve, 0));
      const settingsButton = [...document.querySelectorAll('.cherry-gate button')].find(button => button.textContent.trim() === 'Settings');
      settingsButton?.click(); await new Promise(resolve => setTimeout(resolve, 50));
      const heading = [...document.querySelectorAll('h2')].find(node => node.textContent === 'Integrations');
      const integrations = heading?.closest('section');
      if (!integrations) throw Error('Integrations settings missing');
      integrations.querySelector('[role="button"]').click();
      await new Promise(resolve => setTimeout(resolve, 250));
      const discordSwitch = integrations.querySelector('button[role="switch"][aria-label="Discord"]');
      if (!discordSwitch || discordSwitch.disabled || discordSwitch.closest('[inert]')) throw Error('Discord integration cannot be enabled');
      discordSwitch.click();
      for (let attempt = 0; attempt < 50; attempt++) {
        if ((await bridge.invoke('settings:get', { key: 'settings' })).discordEnabled) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      if (!(await bridge.invoke('settings:get', { key: 'settings' })).discordEnabled) throw Error('Discord toggle did not persist');
      discordSwitch.click();
      for (const placeholder of ['API key', 'Shared secret']) {
        const input = integrations.querySelector('input[placeholder="' + placeholder + '"]');
        if (!input || input.disabled) throw Error('Last.fm settings unavailable');
        input.value = 'synthetic-test'; input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      const connectLastfm = [...integrations.querySelectorAll('button')].find(button => button.textContent.includes('Connect Last.fm'));
      if (!connectLastfm || connectLastfm.disabled || connectLastfm.closest('[inert]')) throw Error('Last.fm cannot be connected from settings');
      let rejected = false;
      try { await bridge.invoke('http_proxy_fetch', { url: 'file:///private' }); } catch { rejected = true; }
      if (!rejected) throw Error('Network validation failed');
      localStorage.setItem('smoke-preserved', 'queue and preferences');
      const cleanup = await bridge.invoke('clear_cache');
      if (cleanup.locked.length) throw Error('Native cache clear failed: ' + cleanup.locked.join(', '));
      if (localStorage.getItem('smoke-preserved') !== 'queue and preferences') throw Error('Cache clear removed app data');
      if (await bridge.invoke('secret_load', { name: 'lastfm' }) !== 'smoke-secret') throw Error('Cache clear removed credentials');
      if (!(await bridge.invoke('cache_size') > 0)) throw Error('Profile size did not include local data');
      const wiped = await bridge.invoke('clear_local_data');
      if (wiped.some(name => name.startsWith('locked:'))) throw Error('Full reset incomplete: ' + wiped.join(', '));
      await bridge.invoke('settings:set', { key: 'settings', value: { stale: true } });
      await bridge.invoke('secret_save', { name: 'lastfm', value: 'stale-secret' });
      if (Object.keys(await bridge.invoke('settings:get', { key: 'settings' })).length) throw Error('Stale renderer settings survived reset');
      if (localStorage.getItem('smoke-preserved')) throw Error('Full reset retained localStorage');
      return { platform, dashManifest: true, mediaTransport: true, updater: true, windowsCaptions: platform === 'windows', maintenance: true, logout: true, mounted: true, isolated: true, settings: true, encryptedSecrets: true, loginCapture: true, networkPolicy: true, discordConfiguration: true, shortcutArtwork: true, integrationSettings: true, nativeActionIPC: true, warmPlaylistLaunch: true, nativeToolbar: true };
    })()`);
    for (const name of ['settings.json', 'lastfm.encrypted', 'auth.encrypted']) {
      try { await readFile(data(name)); throw new Error('Reset retained ' + name); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if ((await loginSession().cookies.get({})).length) throw new Error('Logout retained browser cookies');
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('ELECTRON_SMOKE_PASS ' + JSON.stringify(result));
    app.quit();
  }
}
if (!app.requestSingleInstanceLock({ playlistId: playlistArgument(process.argv) })) app.quit();
else {
  app.on('second-instance', (_event, argv, _directory, extra) => {
    playlistLaunch.receive(typeof extra?.playlistId === 'string' ? ['--open-playlist', extra.playlistId] : argv); if (!smoke) { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); } });
  app.on('will-quit', () => { discord.close(); tray?.destroy(); });
  void main().catch(error => { console.error('Electron startup failed:', error); app.exit(1); });
}
