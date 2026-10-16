import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureYouTubeSession, createAuthPersistence } from './login.mjs';
const cookie = (name, value, domain = '.youtube.com') => ({ name, value, domain });
test('captures both YouTube scopes without accepting Google cookie collisions', async () => {
  const session = await captureYouTubeSession({ get: async ({ url }) => url.includes('music.') ? [cookie('SID', 'youtube'), cookie('SID', 'google', '.google.com')] : [cookie('SAPISID', 'signing')] });
  assert.equal(session.cookie, 'SID=youtube; SAPISID=signing');
});
test('does not finish from partial login cookies or expired cookies', async () => {
  await assert.rejects(captureYouTubeSession({ get: async () => [cookie('SID', 'partial')] }));
  await assert.rejects(captureYouTubeSession({ get: async () => [cookie('SID', 'signed'), { ...cookie('SAPISID', 'expired'), expirationDate: 1 }] }));
});
test('supports secure-prefixed session/signing cookies', async () => {
  const value = await captureYouTubeSession({ get: async () => [cookie('__Secure-3PSID', 'sid'), cookie('__Secure-3PAPISID', 'sig')] });
  assert.ok(value.cookie.includes('__Secure-3PAPISID=sig'));
});
test('falls back to an explicitly temporary session without writing plaintext', async () => {
  let writes = 0, cleared = 0;
  const storage = createAuthPersistence({ available: () => false, read: async () => null, write: async () => { writes++; }, clear: async () => { cleared++; } });
  const saved = await storage.save({ kind: 'cookie', cookie: 'SID=test' });
  assert.equal(saved.persistence, 'memory'); assert.equal(writes, 0); assert.equal(cleared, 1);
  assert.equal((await storage.load()).cookie, 'SID=test');
  await storage.clear(); assert.equal(await storage.load(), null);
});
test('does not swallow real disk/encryption errors when storage is available', async () => {
  const storage = createAuthPersistence({ available: () => true, read: async () => null, write: async () => { throw Error('Disk full'); }, clear: async () => {} });
  await assert.rejects(storage.save({ cookie: 'SID=test' }), /Disk full/);
});
