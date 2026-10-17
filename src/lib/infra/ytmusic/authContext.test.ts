import { expect, it } from 'vitest';
import { signingCookieHeader, accountIndex, authIdentity } from './authContext';
it('supplies the signing cookie expected by youtubei without changing a real SAPISID', () => {
  expect(signingCookieHeader('SID=one; __Secure-3PAPISID=three')).toBe('SAPISID=three; SID=one; __Secure-3PAPISID=three');
  expect(signingCookieHeader('__Secure-1PAPISID=one')).toBe('SAPISID=one; __Secure-1PAPISID=one');
  expect(signingCookieHeader('SAPISID=real; __Secure-3PAPISID=other')).toBe('SAPISID=real; __Secure-3PAPISID=other');
  expect(signingCookieHeader('SID=one')).toBe('SID=one');
});
it('separates Google account indices even when cookies are shared', () => {
  const session = { kind: 'cookie' as const, cookie: 'SID=shared', savedAt: 0 };
  expect(accountIndex(session)).toBe(0);
  expect(accountIndex({ ...session, accountIndex: -1 })).toBe(0);
  expect(authIdentity({ ...session, accountIndex: 1 })).not.toBe(authIdentity(session));
});
