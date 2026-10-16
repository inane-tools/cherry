import { app, BrowserWindow, ipcMain, protocol, net, shell, safeStorage, session, Menu, Tray, nativeImage } from 'electron';
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assetPath, trustedRenderer, externalUrl } from './policy.mjs';
import { fetchAllowed, apiHeaders } from './network.mjs';
import { captureYouTubeSession, createAuthPersistence } from './login.mjs';
import { createDiscordPresence } from './discord.mjs';
import { createLastfm } from './lastfm.mjs';
import { createTaskbarControls } from './taskbar.mjs';
import { createPlaylistImageUpload } from './playlist-image.mjs';
import { createJumpLists, createPlaylistLaunch, playlistArgument } from './jump-list.mjs';
import { prepareWindowsIdentity } from './windows-identity.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, 'assets');
const devUrl = process.env.CHERRY_DEV_URL;
const smoke = process.argv.includes('--smoke-test');
if (devUrl && !/^http:\/\/127\.0\.0\.1:1423\/?$/.test(devUrl)) throw new Error('Invalid development origin');
app.setName('Cherry Electron');
const appId = smoke ? 'tools.inane.cherry.electron.smoke' : 'tools.inane.cherry.electron';
app.setAppUserModelId(appId);
// Never reuse the released app's settings, cookies, updater state or keychain.
const profilePath = smoke ? process.env.CHERRY_SMOKE_PROFILE || join(app.getPath('temp'), 'cherry-electron-smoke-' + Date.now()) : join(app.getPath('appData'), 'cherry-electron');
app.setPath('userData', profilePath);
if (smoke) process.env.CHERRY_SMOKE_PROFILE = profilePath;
protocol.registerSchemesAsPrivileged([
  { scheme: 'cherry', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'cherry-media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);
let window;
let login;
let tray;
let settings = {};
let writeChain = Promise.resolve();
const data = name => join(app.getPath('userData'), name);
const send = (name, value) => { if (window && !window.isDestroyed()) window.webContents.send(name, value); };
const discord = createDiscordPresence();
const lastfm = createLastfm();
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
  ses.setPermissionRequestHandler((_contents, _permission, answer) => answer(false));
  ses.setPermissionCheckHandler(() => false);
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
let loginContext = {};
const secureAuth = createAuthPersistence({
  available: () => safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
  read: () => secretRead('auth'), write: value => secretWrite('auth', value), clear: () => secretWrite('auth', null),
});
async function captureLoginContext() {
  if (!login || login.isDestroyed() || new URL(login.webContents.getURL() || 'about:blank').origin !== 'https://music.youtube.com') return;
  let timeout;
  const value = await Promise.race([
    login.webContents.executeJavaScript("globalThis.ytcfg?.get ? ({ accountIndex: Number(globalThis.ytcfg.get('SESSION_INDEX') ?? 0), selectedChannelId: String(globalThis.ytcfg.get('DELEGATED_SESSION_ID') ?? '') }) : null"),
    new Promise(resolve => { timeout = setTimeout(() => resolve(null), 1000); }),
  ]).catch(() => null).finally(() => clearTimeout(timeout));
  if (value && Number.isInteger(value.accountIndex) && value.accountIndex >= 0) loginContext = value;
}
async function capturedSession() {
  await captureLoginContext();
  if (!Number.isInteger(loginContext.accountIndex)) throw new Error('Waiting for the YouTube Music account page to finish loading.');
  return captureYouTubeSession(loginSession().cookies, Date.now(), loginContext);
}
function browserAgent() { return app.userAgentFallback.replace(/\s(?:Electron|Cherry[^ /]*)\/[^ ]+/g, ''); }
function openLogin() {
  loginAttempt = true;
  if (login && !login.isDestroyed()) { login.focus(); return; }
  loginContext = {};
  const ses = loginSession(); permissions(ses);
  login = new BrowserWindow({ title: 'Sign in to YouTube Music', width: 1020, height: 780, parent: window,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const valid = value => { try { const u = new URL(value); return u.protocol === 'https:' && ['youtube.com', 'google.com'].some(host => u.hostname === host || u.hostname.endsWith('.' + host)); } catch { return false; } };
  login.webContents.on('will-navigate', (event, url) => { if (!valid(url)) event.preventDefault(); });
  login.webContents.on('will-redirect', (event, url) => { if (!valid(url)) event.preventDefault(); });
  login.webContents.setWindowOpenHandler(({ url }) => { if (valid(url)) void login.loadURL(url); return { action: 'deny' }; });
  let closing = false;
  login.webContents.on('did-finish-load', () => { void captureLoginContext(); });
  login.on('close', event => {
    if (closing) return;
    event.preventDefault(); closing = true;
    void captureLoginContext().finally(() => login?.close());
  });
  login.on('closed', () => { login = undefined; });
  void login.loadURL('https://music.youtube.com');
}
function updateTray(state) {
  updateTaskbar(window, state);
  const action = id => () => send('tray://action', id);
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(join(assets, 'icon.png')).resize({ width: 20, height: 20 }));
    tray.setToolTip('Cherry Electron'); tray.on('click', () => { window?.show(); window?.focus(); });
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: state.playing ? 'Pause' : 'Play', enabled: !!state.hasTrack, click: action('toggle') },
    { label: 'Previous', enabled: !!state.hasTrack, click: action('prev') },
    { label: 'Next', enabled: !!state.hasTrack, click: action('next') },
    { label: 'Shuffle', type: 'checkbox', checked: !!state.shuffle, click: action('shuffle') },
    { label: 'Repeat', submenu: ['off', 'all', 'one'].map(mode => ({ label: mode, type: 'radio', checked: state.repeat === mode, click: action('repeat:' + mode) })) },
    ...((state.pinned ?? []).length ? [{ type: 'separator' }, ...(state.pinned ?? []).slice(0, 30).map(p => ({ label: String(p.title).replaceAll('&', '&&'), click: action('playlist:' + p.browseId) }))] : []),
    { type: 'separator' }, { label: 'Show Cherry Electron', click: () => window?.show() }, { label: 'Quit', click: () => app.quit() },
  ]));
}
const commands = {
  ...(smoke ? {
    'smoke:dispatch': ({ action }) => send('tray://action', action),
    'smoke:second-instance': ({ legacy = false }) => promisify(execFile)(process.execPath, [...(!app.isPackaged ? [app.getAppPath()] : []), '--smoke-test', ...(legacy ? ['--open-playlist', 'VLSMOKE'] : ['--open-playlist=VLSMOKE'])], { windowsHide: true, timeout: 10000 }),
  } : {}),
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
  'app:relaunch': () => { app.relaunch(); app.quit(); },
  'app:open-url': ({ url }) => shell.openExternal(externalUrl(url)),
  open_devtools: () => window.webContents.openDevTools({ mode: 'detach' }),
  close_devtools: () => window.webContents.closeDevTools(),
  auth_load: () => secureAuth.load(),
  auth_save: ({ session: value }) => { if (value?.kind !== 'cookie' || typeof value.cookie !== 'string' || value.cookie.length > 100000) throw new Error('Invalid session'); return secureAuth.save(value); },
  auth_clear: async () => { loginAttempt = false; await secureAuth.clear(); await loginSession().clearStorageData(); },
  secret_load: ({ name }) => { if (name !== 'lastfm') throw new Error('Unknown secret'); return secretRead('lastfm'); },
  secret_save: ({ name, value }) => { if (name !== 'lastfm' || typeof value !== 'string' || value.length > 100000) throw new Error('Invalid secret'); return secretWrite('lastfm', value); },
  open_ytm_login: openLogin,
  close_ytm_login: () => { loginAttempt = false; login?.close(); },
  ytm_login_status: async () => ({ open: !!login, url: login?.webContents.getURL() ?? '', loggedIn: loginAttempt && await capturedSession().then(() => true, () => false) }),
  ytm_login_finish: async () => { const value = await secureAuth.save(await capturedSession()); await loginSession().cookies.flushStore(); login?.close(); loginAttempt = false; return value; },
  http_proxy_fetch: async ({ url, method = 'GET', headers = {}, body }) => {
    if (!['GET', 'POST', 'PUT', 'DELETE', 'HEAD'].includes(method) || (body && (typeof body !== 'string' || body.length > 20 * 1024 * 1024))) throw new Error('Invalid HTTP request');
    const clean = apiHeaders(url, headers, browserAgent());
    const response = await fetchAllowed(url, { method, headers: clean, body: body ?? undefined });
    const bytes = await boundedBytes(response);
    return { status: response.status, headers: Object.fromEntries(response.headers), body: bytes.toString('utf8') };
  },
  http_proxy_fetch_base64: async ({ url }) => (await boundedBytes(await fetchAllowed(url))).toString('base64'),
  cache_size: () => session.defaultSession.getCacheSize(),
  clear_local_data: async () => {
    await writeChain; await session.defaultSession.clearCache(); await session.defaultSession.clearStorageData();
    await loginSession().clearStorageData();
    loginAttempt = false; await secureAuth.clear(); await secretWrite('lastfm', null);
    await enqueueWrite(async () => { settings = {}; await rm(data('settings.json'), { force: true }); });
    await rm(data('jump-artwork'), { recursive: true, force: true });
    // Clear optional integrations even if the Windows shell rejects a menu update.
    await discord.clear().catch(() => {});
    const removed = ['Electron cache', 'settings', 'sign-in session', 'shortcut artwork'];
    try { await jumpLists.update([], []); } catch { removed.push('locked:Windows playlist shortcuts'); }
    return removed;
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
  permissions(session.defaultSession);
  await prepareWindowsIdentity({ appId, assets, directory: data('branding'), register: !smoke }).catch(error => console.warn('[windows] Could not register app name/icon:', error.message));
  try { settings = JSON.parse(await readFile(data('settings.json'), 'utf8')); } catch { settings = {}; }
  protocol.handle('cherry', async request => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'app' || request.method !== 'GET') return new Response('Not found', { status: 404 });
      const response = await net.fetch(pathToFileURL(assetPath(join(here, '../dist'), url.pathname === '/' ? '/index.html' : url.pathname)).href);
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; font-src 'self' data:; media-src 'self' https: blob: cherry-media:; connect-src 'self' https: cherry-media:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'");
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
      const response = await fetchAllowed(source, { headers, signal: request.signal }, true);
      if (!response.ok) console.warn('[media] CDN returned HTTP ' + response.status);
      const output = new Headers(cors);
      for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (response.headers.has(name)) output.set(name, response.headers.get(name));
      return new Response(response.body, { status: response.status, headers: output });
    } catch { return new Response('Media request failed', { status: 502, headers: cors }); }
  });
  window = new BrowserWindow({ title: 'Cherry Electron', width: 1280, height: 850, minWidth: 460, minHeight: 540,
    frame: false, show: false, backgroundColor: '#0a0a0f', icon: join(assets, 'icon.png'),
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  if (process.platform === 'win32') window.setAppDetails({ appId, appIconPath: data('branding/icon.ico'), relaunchDisplayName: 'Cherry Electron', relaunchCommand: [process.execPath, ...(!app.isPackaged ? [app.getAppPath()] : [])].map(value => '"' + value + '"').join(' ') });
  ipcMain.handle('desktop:invoke', async (event, command, args = {}) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !trustedRenderer(event.senderFrame.url, devUrl)) throw new Error('Untrusted IPC sender');
    if (!Object.hasOwn(commands, command)) throw new Error('Desktop feature not ported: ' + String(command));
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid command arguments');
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
  if (devUrl) console.log('[desktop] App loaded' + (smoke ? ' (hidden smoke test)' : ''));
  if (smoke) {
    await loginSession().cookies.set({ url: 'https://music.youtube.com/', name: 'SID', value: 'smoke-session-identity' });
    await loginSession().cookies.set({ url: 'https://www.youtube.com/', name: 'SAPISID', value: 'smoke-signing-cookie' });
    loginAttempt = true;
    loginContext = { accountIndex: 2, selectedChannelId: 'smoke-brand' };
    const smokeArtwork = nativeImage.createFromPath(join(assets, 'icon.png')).resize({ width: 64, height: 64 }).toPNG().toString('base64');
    if (process.platform === 'win32' && updateTaskbar(window, { hasTrack: true, playing: true }) !== true) throw new Error('Native taskbar toolbar rejected enabled buttons');
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
      const platform = await bridge.invoke('desktop_platform');
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
      return { platform, mounted: true, isolated: true, settings: true, encryptedSecrets: true, loginCapture: true, networkPolicy: true, discordConfiguration: true, shortcutArtwork: true, integrationSettings: true, nativeActionIPC: true, warmPlaylistLaunch: true, nativeToolbar: true };
    })()`);
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
