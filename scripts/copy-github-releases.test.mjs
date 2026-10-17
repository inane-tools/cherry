import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { validateCopy, assetName, validateTauriManifest, verifyAsset } from './copy-github-releases.mjs';

test('release copying is restricted to the three migration repositories and valid tags', () => {
  validateCopy('inane-tools/cherry', 'inane-tools/cherry-tauri', 'all');
  validateCopy('inane-tools/cherry-electron', 'inane-tools/cherry', 'v1.7.1');
  validateCopy('inane-tools/cherry', 'inane-tools/cherry-electron', 'latest');
  assert.throws(() => validateCopy('other/repo', 'inane-tools/cherry', 'v1.7.1'));
  assert.throws(() => validateCopy('inane-tools/cherry', 'inane-tools/cherry', 'latest'));
  assert.throws(() => validateCopy('inane-tools/cherry', 'inane-tools/cherry-tauri', '--delete'));
});
test('asset names cannot escape the temporary download directory', () => {
  assert.equal(assetName('Cherry-Setup-1.7.1-x64.exe'), 'Cherry-Setup-1.7.1-x64.exe');
  for (const value of ['../secret', '..\\secret', '/tmp/file', '--option', 'a/b', 'a?b']) assert.throws(() => assetName(value));
});
test('legacy manifest stays pinned to signed Tauri binaries in the preserved repository', () => {
  const doc = { version: '1.7.0', platforms: { 'windows-x86_64': { url: 'https://github.com/inane-tools/cherry-tauri/releases/download/v1.7.0/Cherry_1.7.0_x64-setup.exe', signature: 'synthetic-signature'.repeat(4) } } };
  assert.equal(validateTauriManifest(doc), doc);
  assert.throws(() => validateTauriManifest({ ...doc, version: '1.7.2' }));
  assert.throws(() => validateTauriManifest({ ...doc, platforms: { x: { ...doc.platforms['windows-x86_64'], url: 'https://example.com/setup.exe' } } }));
  assert.throws(() => validateTauriManifest({ ...doc, platforms: { x: { ...doc.platforms['windows-x86_64'], signature: '' } } }));
});
test('release asset verification detects truncation and equal-size corruption', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'cherry-copy-test-'));
  try {
    const file = join(folder, 'asset.exe');
    const bytes = Buffer.from('original asset');
    const asset = { name: 'asset.exe', size: bytes.length, digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex') };
    await writeFile(file, bytes);
    assert.equal(await verifyAsset(file, asset), asset.digest);
    await writeFile(file, bytes.subarray(1));
    await assert.rejects(() => verifyAsset(file, asset), /size mismatch/);
    await writeFile(file, Buffer.alloc(bytes.length));
    await assert.rejects(() => verifyAsset(file, asset), /checksum mismatch/);
  } finally {
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
    await rm(folder, { recursive: true, force: true });
  }
});
