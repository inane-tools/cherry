import type { AuthSession } from '$lib/core/models';

/** youtubei.js v18 signs only the unprefixed SAPISID cookie. */
export function signingCookieHeader(cookie: string): string {
  const values = new Map(cookie.split(';').map(part => {
    const offset = part.indexOf('=');
    return [offset < 0 ? part.trim() : part.slice(0, offset).trim(), offset < 0 ? '' : part.slice(offset + 1).trim()];
  }));
  if (values.get('SAPISID')) return cookie;
  const signing = values.get('__Secure-3PAPISID') || values.get('__Secure-1PAPISID');
  return signing ? `SAPISID=${signing}; ${cookie}` : cookie;
}

/** Google account index and brand channel are separate identities. */
export function accountIndex(session?: AuthSession | null): number {
  const value = session?.accountIndex;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}
export function authIdentity(session?: AuthSession | null): string {
  return session?.cookie ? JSON.stringify([session.cookie, accountIndex(session)]) : '';
}
