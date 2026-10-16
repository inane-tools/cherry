import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManifest } from './updater-manifest.mjs';

test('manifest requires both signed installers with matching release versions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cherry-manifest-'));
  try {
    const signature = Buffer.from('untrusted comment: test\nabc\ntrusted comment: test\ndef').toString('base64');
    const windows = join(dir, 'Cherry_1.6.2_x64-setup.exe');
    const linux = join(dir, 'Cherry_1.6.2_amd64.AppImage');
    await writeFile(windows, 'fixture'); await writeFile(`${windows}.sig`, signature);
    await assert.rejects(createManifest(dir, '1.6.2'), /linux-x86_64/);
    await writeFile(linux, 'fixture');
    await assert.rejects(createManifest(dir, '1.6.2'), /ENOENT/);
    await writeFile(`${linux}.sig`, 'filename.sig');
    await assert.rejects(createManifest(dir, '1.6.2'), /Invalid signature/);
    await writeFile(`${linux}.sig`, signature);
    const manifest = await createManifest(dir, '1.6.2', 'Release notes');
    assert.equal(manifest.platforms['windows-x86_64'].signature, signature);
    assert.equal(manifest.platforms['linux-x86_64'].url, 'https://github.com/inane-tools/cherry/releases/download/v1.6.2/Cherry_1.6.2_amd64.AppImage');
    await assert.rejects(createManifest(dir, '1.7.0'), /does not match/);
    await writeFile(join(dir, 'other_1.6.2_x64-setup.exe'), 'fixture');
    await assert.rejects(createManifest(dir, '1.6.2'), /exactly one/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
