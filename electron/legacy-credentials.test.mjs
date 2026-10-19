import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createLegacyCredentialReader, readLegacySession, parseLegacyLastfm } from './legacy-credentials.mjs';

const session = { kind: 'cookie', cookie: 'SID=fixture; SAPISID=' + 'not-a-real-secret'.repeat(10), savedAt: 123, accountLabel: 'Fixture' };
const stored = JSON.stringify(session);

test('reassembles Tauri v2 chunks and supports single-entry and xylo sessions', async () => {
  const calls = [];
  const entries = new Map([['cherry:ytmusic-session', JSON.stringify({ v: 2, parts: 2 })], ['cherry:ytmusic-session.p0', stored.slice(0, 71)], ['cherry:ytmusic-session.p1', stored.slice(71)]]);
  const read = async (service, user) => { calls.push(service + ':' + user); return entries.get(service + ':' + user) ?? null; };
  assert.deepEqual(await readLegacySession(read), session);
  assert.deepEqual(calls, ['cherry:ytmusic-session', 'cherry:ytmusic-session.p0', 'cherry:ytmusic-session.p1']);
  assert.deepEqual(await readLegacySession(async (service, user) => service === 'xylo' && user === 'ytmusic-session' ? stored : null), session);
  assert.equal(await readLegacySession(async () => null), null);
});

test('rejects broken manifests, missing chunks and malformed sessions without leaking payloads', async () => {
  for (const raw of ['{"secret":"DO_NOT_LOG"', '{"v":3,"parts":1}', '{"v":2,"parts":257}', '{"v":2,"parts":0}', '{"v":2,"parts":1.5}', JSON.stringify({ cookie: 'bad\nDO_NOT_LOG' })]) {
    await assert.rejects(readLegacySession(async () => raw), error => !error.message.includes('DO_NOT_LOG'));
  }
  await assert.rejects(readLegacySession(async (_service, user) => user === 'ytmusic-session' ? '{"v":2,"parts":2}' : null), /missing a chunk/);
});

test('Last.fm validation copies only secret fields and allows an absent account', () => {
  assert.deepEqual(parseLegacyLastfm('{"lastfmApiSecret":"api-fixture","lastfmSessionKey":"session-fixture","other":"drop"}'), { lastfmApiSecret: 'api-fixture', lastfmSessionKey: 'session-fixture' });
  assert.equal(parseLegacyLastfm(null), null);
  assert.equal(parseLegacyLastfm({ theme: 'dark' }), null);
  assert.throws(() => parseLegacyLastfm('{"lastfmSessionKey":{}}'), /damaged/);
});

test('Windows helper receives only fixed flags; its credential output stays inside the reader', async () => {
  const calls = [];
  const reader = createLegacyCredentialReader({ platform: 'win32', systemRoot: 'C:/Windows', helperPath: 'fixture/helper.ps1', execute: async (...args) => {
    calls.push(args);
    return { stdout: '\uFEFF' + JSON.stringify({ 'ytmusic-session.cherry': stored, 'secret.lastfm.cherry': '{"lastfmApiSecret":"fake-api","lastfmSessionKey":"fake-session"}' }) };
  } });
  const result = await reader();
  assert.deepEqual(result.auth, session);
  assert.equal(result.lastfm.lastfmSessionKey, 'fake-session');
  assert.equal(calls[0][2].windowsHide, true);
  assert.ok(calls[0][1].includes('-ReadAuth'));
  assert.ok(calls[0][1].includes('-ReadLastfm'));
  assert.ok(!JSON.stringify(calls[0][1]).includes(session.cookie));
});

test('helper failure never propagates its stdout/stderr containing secrets', async () => {
  const reader = createLegacyCredentialReader({ platform: 'win32', helperPath: 'fixture.ps1', execute: async () => {
    throw Object.assign(Error('DO_NOT_LOG'), { stdout: 'SECRET', stderr: 'SECRET' });
  } });
  await assert.rejects(reader(), error => error.message.includes('Credential Manager') && !error.message.includes('SECRET') && !error.message.includes('DO_NOT_LOG'));
});

test('Linux reads only Cherry Secret Service attributes and falls back to older target-less entries', async () => {
  const calls = [];
  const reader = createLegacyCredentialReader({ platform: 'linux', execute: async (exe, args) => {
    calls.push([exe, args]);
    if (args.includes('target')) throw Object.assign(Error('absent'), { code: 1, stdout: '', stderr: '' });
    return { stdout: args.includes('secret.lastfm') ? '{"lastfmApiSecret":"fixture","lastfmSessionKey":"session"}\n' : stored + '\n' };
  } });
  const result = await reader();
  assert.deepEqual(result.auth, session);
  assert.equal(result.lastfm.lastfmSessionKey, 'session');
  assert.deepEqual(calls[0], ['/usr/bin/secret-tool', ['lookup', 'service', 'cherry', 'username', 'ytmusic-session', 'target', 'default']]);
  assert.equal(calls[1][1].includes('target'), false);
});

test('Flatpak uses the bundled helper and skips credential kinds already present in Electron', async () => {
  const calls = [];
  const reader = createLegacyCredentialReader({ platform: 'linux', flatpak: true, execute: async (exe, args) => {
    calls.push([exe, args]); return { stdout: '{"lastfmApiSecret":"fixture","lastfmSessionKey":"session"}\n' };
  } });
  const result = await reader({ auth: false, lastfm: true });
  assert.equal(result.auth, null);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['/app/bin/secret-tool', ['lookup', 'service', 'cherry', 'username', 'secret.lastfm', 'target', 'default']]);
});

test('missing Linux helper and locked keyring are actionable failures rather than lost logins', async () => {
  const missing = createLegacyCredentialReader({ platform: 'linux', execute: async () => { throw Object.assign(Error('absent'), { code: 'ENOENT' }); } });
  await assert.rejects(missing(), /secret-tool/);
  const locked = createLegacyCredentialReader({ platform: 'linux', execute: async () => { throw Object.assign(Error('locked'), { code: 1, stderr: 'private' }); } });
  await assert.rejects(locked(), /Unlock your keyring/);
});

test('Windows helper compiles and validates its native ABI without touching the real credential store', { skip: process.platform !== 'win32' }, async () => {
  const helper = fileURLToPath(new URL('./legacy-credentials.ps1', import.meta.url));
  const { stdout } = await promisify(execFile)(join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-ValidateOnly'], { windowsHide: true, timeout: 30000 });
  assert.equal(stdout, 'valid');
});
