import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const macFiles = ['arm64', 'x64'].map(arch => `Cherry-${version}-mac-${arch}.dmg`);

async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'cherry-release-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const content = Buffer.from('release validation fixture');
  const binaries = [`Cherry-Setup-${version}-x64.exe`, `Cherry-${version}-x86_64.AppImage`];
  for (const file of [...binaries, `${binaries[0]}.blockmap`, `Cherry-${version}-x86_64.flatpak`, ...macFiles]) {
    await writeFile(join(folder, file), content);
  }
  for (const [i, file] of ['latest.yml', 'latest-linux.yml'].entries()) {
    const sha512 = createHash('sha512').update(content).digest('base64');
    await writeFile(join(folder, file), JSON.stringify({ version, path: binaries[i], sha512,
      files: [{ url: binaries[i], sha512, size: content.length }] }));
  }
  return folder;
}

function check(folder) {
  return spawnSync(process.execPath, [fileURLToPath(new URL('./publish-release.mjs', import.meta.url)), folder, '--check'], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REPOSITORY: 'inane-tools/cherry', GITHUB_REF: `refs/tags/v${version}`, GH_TOKEN: '' },
  });
}

test('accepts a complete release with both macOS installers and existing updater feeds', async t => {
  const result = check(await fixture(t));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verified 9 assets/);
});

for (const file of macFiles) {
  test(`rejects a release missing ${file}`, async t => {
    const folder = await fixture(t);
    await rm(join(folder, file));
    const result = check(folder);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(`Missing/empty release asset: ${file}`), result.stderr);
  });
}

test('rejects an empty macOS installer', async t => {
  const folder = await fixture(t);
  await writeFile(join(folder, macFiles[0]), '');
  assert.match(check(folder).stderr, /Missing\/empty release asset/);
});

test('rejects accidental macOS updater metadata while macOS updates are manual', async t => {
  const folder = await fixture(t);
  await writeFile(join(folder, 'latest-mac.yml'), '{}');
  assert.match(check(folder).stderr, /Unexpected files/);
});

test('still rejects corrupted Windows updater binaries', async t => {
  const folder = await fixture(t);
  await writeFile(join(folder, `Cherry-Setup-${version}-x64.exe`), 'corrupted');
  assert.match(check(folder).stderr, /Updater checksum\/size mismatch/);
});
