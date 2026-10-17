const urls = ['https://music.youtube.com/', 'https://www.youtube.com/'];
const signing = ['SAPISID', '__Secure-3PAPISID', '__Secure-1PAPISID'];
const markers = ['SID', 'SSID', 'HSID', 'LOGIN_INFO', '__Secure-1PSID', '__Secure-3PSID'];

/** Never merge Google's different SID/SAPISID over YouTube's cookies. */
export async function captureYouTubeSession(store, now = Date.now(), context = {}) {
  const jars = await Promise.all(urls.map(url => store.get({ url })));
  const cookies = new Map();
  for (const jar of jars) for (const cookie of jar) {
    const domain = cookie.domain.replace(/^\./, '').toLowerCase();
    if (domain !== 'youtube.com' && !domain.endsWith('.youtube.com')) continue;
    if (!cookie.value || /[;\r\n]/.test(cookie.value) || /[;=\r\n]/.test(cookie.name)) continue;
    if (cookie.expirationDate && cookie.expirationDate <= now / 1000) continue;
    if (!cookies.has(cookie.name)) cookies.set(cookie.name, cookie.value);
  }
  if (!signing.some(name => cookies.has(name)) || !markers.some(name => cookies.has(name))) {
    throw new Error('Waiting for YouTube to finish signing in. Return to YouTube Music after the Google sign-in step.');
  }
  return { kind: 'cookie',
    accountIndex: Number.isInteger(context.accountIndex) && context.accountIndex >= 0 ? context.accountIndex : 0,
    ...(typeof context.selectedChannelId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(context.selectedChannelId) ? { selectedChannelId: context.selectedChannelId } : {}),
    cookie: [...cookies].map(([name, value]) => name + '=' + value).join('; '), savedAt: now };
}

/** Remain usable without ever writing plaintext credentials on Linux. */
export function createAuthPersistence({ available, read, write, clear }) {
  let memory = null;
  return {
    async load() { return memory ?? (available() ? await read() : null); },
    async save(value) {
      if (!available()) {
        memory = { ...value, persistence: 'memory' };
        // Remove any old identity that would otherwise return on next launch.
        await clear();
        return memory;
      }
      const saved = { ...value }; delete saved.persistence;
      await write(saved); memory = null;
      return saved;
    },
    async clear() { await clear(); memory = null; },
  };
}
