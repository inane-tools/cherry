import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const run = promisify(execFile);
const users = /^(ytmusic-session(?:\.p(?:0|[1-9]\d{0,2}))?|secret\.lastfm)$/;
function json(value) {
  try { return JSON.parse(value); } catch { throw new Error('A legacy credential is damaged. No credentials were changed.'); }
}

/** Accept old single-entry sessions and keyring's v2 manifest/chunk format. */
export async function readLegacySession(read, service = 'cherry') {
  const raw = await read(service, 'ytmusic-session');
  if (raw === null) return service === 'cherry' ? readLegacySession(read, 'xylo') : null;
  let session = json(raw);
  if (session && Object.hasOwn(session, 'v')) {
    if (session.v !== 2 || !Number.isInteger(session.parts) || session.parts < 1 || session.parts > 256) throw new Error('The legacy sign-in has an unsupported chunk format.');
    let payload = '';
    for (let index = 0; index < session.parts; index++) {
      const part = await read(service, 'ytmusic-session.p' + index);
      if (typeof part !== 'string' || part.length > 3000) throw new Error('The legacy sign-in is missing a chunk. Open the old app and sign in again before retrying.');
      payload += part;
      if (payload.length > 150000) throw new Error('The legacy sign-in is too large.');
    }
    session = json(payload);
  }
  if (!session || (session.kind !== undefined && session.kind !== 'cookie') || typeof session.cookie !== 'string' ||
      session.cookie.length <= 40 || session.cookie.length > 100000 || /[\r\n\x00]/.test(session.cookie) ||
      !/(?:^|;\s*)(?:SAPISID|__Secure-[13]PAPISID)=/.test(session.cookie)) throw new Error('The legacy YouTube Music sign-in is incomplete. Sign in again in the old app before retrying.');
  return { kind: 'cookie', cookie: session.cookie, savedAt: Number.isSafeInteger(session.savedAt) && session.savedAt >= 0 ? session.savedAt : Date.now(),
    ...(typeof session.accountLabel === 'string' && session.accountLabel.length <= 512 ? { accountLabel: session.accountLabel } : {}) };
}

export function parseLegacyLastfm(raw) {
  if (raw === null) return null;
  const value = typeof raw === 'string' ? json(raw) : raw;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The legacy Last.fm credential is damaged.');
  const result = {};
  for (const key of ['lastfmApiSecret', 'lastfmSessionKey']) {
    const entry = value[key] ?? '';
    if (typeof entry !== 'string' || entry.length > 4096 || /[\x00-\x1f]/.test(entry)) throw new Error('The legacy Last.fm credential is damaged.');
    result[key] = entry;
  }
  return result.lastfmApiSecret || result.lastfmSessionKey ? result : null;
}

/** Read only Cherry's fixed keyring entries; secrets never enter arguments or logs. */
export function createLegacyCredentialReader({ platform = process.platform, helperPath, systemRoot = process.env.SystemRoot,
  flatpak = !!process.env.FLATPAK_ID, execute = run } = {}) {
  return async ({ auth = true, lastfm = true } = {}) => {
    const signal = AbortSignal.timeout(90000);
    let read;
    if (platform === 'win32') {
      let output;
      try {
        output = await execute(join(systemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath,
            ...(auth ? ['-ReadAuth'] : []), ...(lastfm ? ['-ReadLastfm'] : [])],
          { windowsHide: true, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, signal });
      } catch { throw new Error('Windows Credential Manager could not be read. Import was cancelled; the old sign-in is unchanged.'); }
      const entries = json(output.stdout.replace(/^\uFEFF/, ''));
      read = async (service, user) => {
        const value = entries?.[user + '.' + service];
        if (value === undefined || value === null) return null;
        if (typeof value !== 'string' || value.length > 150000) throw new Error('An invalid legacy credential was returned.');
        return value;
      };
    } else if (platform === 'linux') {
      read = async (service, user) => {
        if (!['cherry', 'xylo'].includes(service) || !users.test(user)) throw new Error('Unknown legacy credential.');
        for (const target of [true, false]) {
          try {
            const { stdout } = await execute(flatpak ? '/app/bin/secret-tool' : '/usr/bin/secret-tool', ['lookup', 'service', service, 'username', user,
              ...(target ? ['target', 'default'] : [])], { encoding: 'utf8', maxBuffer: 512 * 1024, signal });
            return stdout.replace(/\r?\n$/, '');
          } catch (error) {
            if (error.code === 'ENOENT') throw new Error('Credential migration needs secret-tool (libsecret-tools on Debian/Ubuntu, libsecret on Fedora). Install it, or turn off sign-in import for now.');
            if (error.code === 1 && !error.stderr?.trim() && !error.stdout?.trim()) continue;
            throw new Error('The Secret Service keyring could not be read. Unlock your keyring and try again.');
          }
        }
        return null;
      };
    } else throw new Error('Credential migration currently supports Windows and Linux.');
    return { auth: auth ? await readLegacySession(read) : null,
      lastfm: lastfm ? parseLegacyLastfm(await read('cherry', 'secret.lastfm')) : null };
  };
}
