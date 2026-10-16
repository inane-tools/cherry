import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { profileSize, cleanupSteps, clearSessionCaches } from './maintenance.mjs';

test('profile size includes settings, secrets and nested login/cache storage once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cherry-maintenance-'));
  try {
    await mkdir(join(root, 'Partitions', 'youtube-login'), { recursive: true });
    await writeFile(join(root, 'settings.json'), '12345');
    await writeFile(join(root, 'auth.encrypted'), '1234567');
    await writeFile(join(root, 'Partitions', 'youtube-login', 'Cookies'), '123');
    assert.equal(await profileSize(root), 15);
    assert.equal(await profileSize(join(root, 'missing')), 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('does not follow a junction outside the profile or double-count files through it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cherry-profile-links-'));
  const outside = await mkdtemp(join(tmpdir(), 'cherry-outside-'));
  try {
    await writeFile(join(outside, 'private'), 'do not count');
    await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(await profileSize(root), 0);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test('one locked resource does not skip the rest or report successful deletion', async () => {
  const ran = [];
  const result = await cleanupSteps([
    ['locked', async () => { throw Error('locked'); }],
    ['settings', async () => { ran.push('settings'); }],
  ]);
  assert.deepEqual(result, { removed: ['settings'], locked: ['locked'] });
  assert.deepEqual(ran, ['settings']);
});

test('cache-only clears both sessions without touching credentials or storage', async () => {
  const calls = [];
  const make = name => ({
    clearCache: async () => { calls.push(name + ':HTTP'); },
    clearCodeCaches: async options => { assert.deepEqual(options, {}); calls.push(name + ':code'); },
    clearData: () => { throw Error('must preserve stored account data'); },
    clearStorageData: () => { throw Error('must preserve stored account data'); },
  });
  const result = await clearSessionCaches([['App', make('app')], ['Login', make('login')]]);
  assert.equal(result.removed.length, 4);
  assert.deepEqual(result.locked, []);
  assert.deepEqual(calls, ['app:HTTP', 'app:code', 'login:HTTP', 'login:code']);
});
