import { app, BrowserWindow, ipcMain, protocol, net, shell, safeStorage, session, Menu, Tray, nativeImage } from 'electron';
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allowedRequest, mediaRequest, assetPath, trustedRenderer, externalUrl } from './policy.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, 'assets');
const devUrl = process.env.CHERRY_DEV_URL;
const smoke = process.argv.includes('--smoke-test');
if (devUrl && !/^http:\/\/127\.0\.0\.1:1423\/?$/.test(devUrl)) throw new Error('Invalid development origin');
app.setName('Cherry Electron');
app.setAppUserModelId('tools.inane.cherry.electron');
// Never reuse the released app's settings, cookies, updater state or keychain.
app.setPath('userData', smoke ? join(app.getPath('temp'), 'cherry-electron-smoke-' + Date.now()) : join(app.getPath('appData'), 'cherry-electron'));
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
async function fetchAllowed(value, options = {}, media = false) {
  let url = media ? mediaRequest(value) : allowedRequest(value);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    await response.body?.cancel();
    const next = new URL(response.headers.get('location') ?? '', url);
    if (next.origin !== url.origin) {
      const headers = new Headers(options.headers);
      headers.delete('cookie'); headers.delete('authorization');
      options = { ...options, headers };
    }
    url = media ? mediaRequest(next) : allowedRequest(next);
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && options.method === 'POST')) {
      options = { ...options, method: 'GET', body: undefined };
    }
  }
  throw new Error('Too many network redirects');
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
async function capturedSession() {
  const cookies = await loginSession().cookies.get({ url: 'https://music.youtube.com' });
  if (!cookies.some(cookie => ['SID', 'SAPISID', '__Secure-3PAPISID'].includes(cookie.name))) throw new Error('Complete YouTube sign-in first');
  return { kind: 'cookie', cookie: cookies.map(cookie => cookie.name + '=' + cookie.value).join('; '), savedAt: Date.now() };
}
function openLogin() {
  if (login && !login.isDestroyed()) { login.focus(); return; }
  const ses = loginSession(); permissions(ses);
  login = new BrowserWindow({ title: 'Sign in to YouTube Music', width: 1020, height: 780, parent: window,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const valid = value => { try { const u = new URL(value); return u.protocol === 'https:' && ['youtube.com', 'google.com'].some(host => u.hostname === host || u.hostname.endsWith('.' + host)); } catch { return false; } };
  login.webContents.on('will-navigate', (event, url) => { if (!valid(url)) event.preventDefault(); });
  login.webContents.on('will-redirect', (event, url) => { if (!valid(url)) event.preventDefault(); });
  login.webContents.setWindowOpenHandler(({ url }) => { if (valid(url)) void login.loadURL(url); return { action: 'deny' }; });
  login.on('closed', () => { login = undefined; });
  void login.loadURL('https://music.youtube.com');
}
function updateTray(state) {
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
  auth_load: () => secretRead('auth'),
  auth_save: ({ session: value }) => { if (value?.kind !== 'cookie' || typeof value.cookie !== 'string' || value.cookie.length > 100000) throw new Error('Invalid session'); return secretWrite('auth', value); },
  auth_clear: async () => { await secretWrite('auth', null); await loginSession().clearStorageData(); },
  secret_load: ({ name }) => { if (name !== 'lastfm') throw new Error('Unknown secret'); return secretRead('lastfm'); },
  secret_save: ({ name, value }) => { if (name !== 'lastfm' || typeof value !== 'string' || value.length > 100000) throw new Error('Invalid secret'); return secretWrite('lastfm', value); },
  open_ytm_login: openLogin,
  close_ytm_login: () => login?.close(),
  ytm_login_status: async () => ({ open: !!login, url: login?.webContents.getURL() ?? '', loggedIn: await capturedSession().then(() => true, () => false) }),
  ytm_login_finish: async () => { const value = await capturedSession(); await secretWrite('auth', value); login?.close(); return value; },
  http_proxy_fetch: async ({ url, method = 'GET', headers = {}, body }) => {
    if (!['GET', 'POST', 'PUT', 'DELETE', 'HEAD'].includes(method) || (body && (typeof body !== 'string' || body.length > 20 * 1024 * 1024))) throw new Error('Invalid HTTP request');
    const clean = new Headers(headers); for (const key of ['host', 'connection', 'content-length', 'transfer-encoding']) clean.delete(key);
    const destination = allowedRequest(url);
    if (destination.hostname.endsWith('youtube.com') || destination.hostname.endsWith('google.com')) clean.set('Origin', 'https://music.youtube.com');
    const response = await fetchAllowed(url, { method, headers: clean, body: body ?? undefined });
    const bytes = await boundedBytes(response);
    return { status: response.status, headers: Object.fromEntries(response.headers), body: bytes.toString('utf8') };
  },
  http_proxy_fetch_base64: async ({ url }) => (await boundedBytes(await fetchAllowed(url))).toString('base64'),
  cache_size: () => session.defaultSession.getCacheSize(),
  clear_local_data: async () => {
    await writeChain; await session.defaultSession.clearCache(); await session.defaultSession.clearStorageData();
    await loginSession().clearStorageData();
    await secretWrite('auth', null); await secretWrite('lastfm', null);
    await enqueueWrite(async () => { settings = {}; await rm(data('settings.json'), { force: true }); });
    return ['Electron cache', 'settings', 'sign-in session'];
  },
  take_playlist_launch: () => null,
  update_tray: ({ state }) => updateTray(state),
  update_jump_list: () => null, // Scaffold: desktop Jump Lists are not ported yet.
  jump_artwork_cached: () => true,
  discord_set_app_id: () => ({ configured: false }),
  discord_clear_presence: () => null,
  discord_set_presence: () => { throw new Error('Discord RPC is not ported to Electron yet'); },
};
async function main() {
  await app.whenReady();
  permissions(session.defaultSession);
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
      const response = await fetchAllowed(source, { headers }, true);
      const output = new Headers(cors);
      for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (response.headers.has(name)) output.set(name, response.headers.get(name));
      return new Response(response.body, { status: response.status, headers: output });
    } catch { return new Response('Media request failed', { status: 502, headers: cors }); }
  });
  window = new BrowserWindow({ title: 'Cherry Electron', width: 1280, height: 850, minWidth: 460, minHeight: 540,
    frame: false, show: false, backgroundColor: '#0a0a0f', icon: join(assets, 'icon.png'),
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  ipcMain.handle('desktop:invoke', async (event, command, args = {}) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !trustedRenderer(event.senderFrame.url, devUrl)) throw new Error('Untrusted IPC sender');
    if (!Object.hasOwn(commands, command)) throw new Error('Desktop feature not ported: ' + String(command));
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid command arguments');
    return commands[command](args);
  });
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
    const errors = [];
    window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    const result = await window.webContents.executeJavaScript(`(async () => {
      const bridge = window.cherryDesktop;
      if (!bridge || typeof require !== 'undefined' || typeof process !== 'undefined') throw Error('Renderer isolation failed');
      for (let i = 0; i < 100 && !document.body.textContent.includes('Welcome to Cherry'); i++) await new Promise(r => setTimeout(r, 100));
      if (!document.body.textContent.includes('Welcome to Cherry')) throw Error('App did not mount');
      const platform = await bridge.invoke('desktop_platform');
      await bridge.invoke('settings:set', { key: 'settings', value: { lyricsEnabled: true, theme: 'dark' } });
      const settings = await bridge.invoke('settings:get', { key: 'settings' });
      if (!settings.lyricsEnabled) throw Error('Settings round trip failed');
      await bridge.invoke('secret_save', { name: 'lastfm', value: 'smoke-secret' });
      if (await bridge.invoke('secret_load', { name: 'lastfm' }) !== 'smoke-secret') throw Error('Encrypted secret round trip failed');
      let rejected = false;
      try { await bridge.invoke('http_proxy_fetch', { url: 'file:///private' }); } catch { rejected = true; }
      if (!rejected) throw Error('Network validation failed');
      return { platform, mounted: true, isolated: true, settings: true, encryptedSecrets: true, networkPolicy: true };
    })()`);
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('ELECTRON_SMOKE_PASS ' + JSON.stringify(result));
    app.quit();
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); });
  app.on('will-quit', () => { tray?.destroy(); });
  void main().catch(error => { console.error('Electron startup failed:', error); app.exit(1); });
}
