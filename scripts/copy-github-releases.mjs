// Copy published release files byte-for-byte. Never invokes a build or installer.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const repos = new Set(['inane-tools/cherry', 'inane-tools/cherry-tauri', 'inane-tools/cherry-electron']);
export function validateCopy(source, destination, tag) {
  if (!repos.has(source) || !repos.has(destination) || source === destination) throw Error('Invalid release-copy repositories');
  if (!['all', 'latest'].includes(tag) && !/^v\d+\.\d+(?:\.\d+)?(?:[-.][A-Za-z0-9]+)*$/.test(tag)) throw Error('Invalid release tag');
}
export function assetName(name) {
  if (typeof name !== 'string' || basename(name) !== name || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(name)) throw Error('Unsafe release asset name');
  return name;
}
export function validateTauriManifest(doc) {
  if (doc.version !== '1.7.0' || !doc.platforms || Object.keys(doc.platforms).length === 0) throw Error('Invalid pinned Tauri version');
  for (const platform of Object.values(doc.platforms)) {
    const url = new URL(platform.url);
    if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/inane-tools/cherry-tauri/releases/download/v1.7.0/') || url.username || url.password || url.search || url.hash || !/\.(exe|AppImage)$/.test(url.pathname)) throw Error('Unsafe legacy update URL');
    if (typeof platform.signature !== 'string' || platform.signature.trim().length < 40) throw Error('Missing Tauri signature');
  }
  return doc;
}
export async function loadTauriCompatibility(file) {
  const bytes = await readFile(file);
  validateTauriManifest(JSON.parse(bytes));
  return bytes;
}
export async function verifyAsset(file, asset) {
  assetName(asset.name);
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || (await stat(file)).size !== asset.size) throw Error('Release asset size mismatch: ' + asset.name);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const digest = 'sha256:' + hash.digest('hex');
  if (asset.digest && asset.digest !== digest) throw Error('Release asset checksum mismatch: ' + asset.name);
  return digest;
}
export function isMissingGitHubResource(stderr) {
  return /HTTP 404|Not Found/.test(stderr) ||
    (/HTTP 422/.test(stderr) && /No commit found for SHA:/.test(stderr));
}
function gh(args, missing = false) {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 15 * 60 * 1000 });
  if (result.status !== 0) {
    if (missing && isMissingGitHubResource(result.stderr || '')) return null;
    throw Error(result.stderr || result.error?.message || 'GitHub CLI failed');
  }
  return result.stdout;
}
function api(path, missing = false) {
  const text = gh(['api', path], missing);
  return text === null ? null : JSON.parse(text);
}
function destinationRelease(repository, tag) {
  // GitHub's release-by-tag endpoint can hide drafts even from the workflow.
  // The authenticated release list includes them, allowing safe retries.
  return api(`repos/${repository}/releases/tags/${encodeURIComponent(tag)}`, true)
    ?? api(`repos/${repository}/releases?per_page=100`).find(release => release.tag_name === tag)
    ?? null;
}
async function copyRelease(source, destination, release, latestTag, compatibility) {
  const tag = release.tag_name;
  validateCopy(source, destination, tag);
  if (release.draft) return;
  const bridge = destination === 'inane-tools/cherry-electron';
  if (bridge && !['latest.yml', 'latest-linux.yml'].every(name => release.assets.some(asset => asset.name === name))) {
    console.log('Skipping non-Electron release ' + tag); return;
  }
  const assets = release.assets.filter(asset => !bridge || asset.name !== 'latest.json');
  for (const asset of assets) assetName(asset.name);
  const expected = assets.map(asset => ({ name: asset.name, size: asset.size, digest: asset.digest }));
  if (compatibility) {
    if (expected.some(asset => asset.name === 'latest.json')) throw Error('Source already contains a legacy manifest');
    expected.push({ name: 'latest.json', size: compatibility.length, digest: 'sha256:' + createHash('sha256').update(compatibility).digest('hex') });
  }
  const existing = destinationRelease(destination, tag);
  if (existing && !existing.draft) {
    if (existing.assets.length !== expected.length || expected.some(asset => !existing.assets.some(copy => copy.name === asset.name && copy.size === asset.size && (!asset.digest || !copy.digest || asset.digest === copy.digest)))) throw Error('Published destination release differs; refusing to overwrite ' + tag);
    console.log('Already copied ' + tag); return;
  }
  const commit = api(`repos/${source}/commits/${encodeURIComponent(tag)}`).sha;
  let destinationCommit = api(`repos/${destination}/commits/${encodeURIComponent(tag)}`, true);
  if (!destinationCommit) {
    if (bridge) {
      // A compatibility feed only mirrors verified assets. Tag its existing
      // history so the token needs contents:write, not workflow-import rights.
      const branch = api(`repos/${destination}`).default_branch;
      const target = api(`repos/${destination}/commits/${encodeURIComponent(branch)}`).sha;
      gh(['api', '--method', 'POST', `repos/${destination}/git/refs`, '-f', `ref=refs/tags/${tag}`, '-f', `sha=${target}`]);
    } else {
      execFileSync('git', ['fetch', '--no-tags', `https://github.com/${source}.git`, `refs/tags/${tag}`], { stdio: 'inherit' });
      const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
      if (origin.replace(/\.git$/, '') !== `https://github.com/${destination}`) throw Error('Checkout origin does not match destination');
      // GITHUB_TOKEN pushes do not trigger a tag build. This only copies history.
      execFileSync('git', ['push', 'origin', `FETCH_HEAD:refs/tags/${tag}`], { stdio: 'inherit' });
    }
    destinationCommit = api(`repos/${destination}/commits/${encodeURIComponent(tag)}`);
  }
  if (!bridge && destinationCommit.sha !== commit) throw Error('Destination tag points at different code: ' + tag);
  const folder = await mkdtemp(join(tmpdir(), 'cherry-release-copy-'));
  try {
    if (assets.length) gh(['release', 'download', tag, '--repo', source, '--dir', folder]);
    const checksums = new Map();
    for (const asset of assets) checksums.set(asset.name, await verifyAsset(join(folder, asset.name), asset));
    if (compatibility) {
      await writeFile(join(folder, 'latest.json'), compatibility);
      checksums.set('latest.json', expected.at(-1).digest);
    }
    const notes = join(folder, 'release-notes.md');
    await writeFile(notes, (release.body || '') + `\n\nOriginally published ${release.published_at || ''}: ${release.html_url}\n`);
    if (!existing) gh(['release', 'create', tag, '--repo', destination, '--verify-tag', '--title', release.name || tag, '--notes-file', notes, '--draft', ...(release.prerelease ? ['--prerelease'] : [])]);
    if (expected.length) gh(['release', 'upload', tag, '--repo', destination, '--clobber', ...expected.map(asset => join(folder, asset.name))]);
    const uploaded = destinationRelease(destination, tag);
    if (uploaded.assets.length !== expected.length || expected.some(asset => !uploaded.assets.some(copy => copy.name === asset.name && copy.size === asset.size && (!copy.digest || copy.digest === checksums.get(asset.name))))) throw Error('Uploaded assets failed verification: ' + tag);
    gh(['release', 'edit', tag, '--repo', destination, '--title', release.name || tag, '--notes-file', notes, '--draft=false', `--prerelease=${release.prerelease}`, `--latest=${tag === latestTag && !release.prerelease}`]);
    console.log(`Copied ${tag}: ${expected.length} verified assets; no build performed`);
  } finally {
    if (dirname(resolve(folder)) !== resolve(tmpdir())) throw Error('Unsafe temporary cleanup path');
    await rm(folder, { recursive: true, force: true });
  }
}
async function main() {
  const source = process.env.COPY_SOURCE_REPO;
  const destination = process.env.GITHUB_REPOSITORY;
  const tag = process.env.COPY_RELEASE_TAG;
  validateCopy(source, destination, tag);
  if (!process.env.GH_TOKEN || process.env.GITHUB_ACTIONS !== 'true') throw Error('Run release copying from its GitHub Actions workflow');
  if (api(`repos/${source}`).private) throw Error('Release source must be public');
  const latest = api(`repos/${source}/releases/latest`, true);
  const compatibility = process.env.COPY_INCLUDE_TAURI_MANIFEST === 'true' ? await loadTauriCompatibility(new URL('../build/tauri-latest.json', import.meta.url)) : null;
  const releases = tag === 'all'
    ? JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${source}/releases?per_page=100`])).flat().filter(release => !release.draft).sort((a, b) => (a.published_at || '').localeCompare(b.published_at || ''))
    : tag === 'latest' ? (latest ? [latest] : []) : [api(`repos/${source}/releases/tags/${encodeURIComponent(tag)}`)];
  for (const release of releases) await copyRelease(source, destination, release, latest?.tag_name, compatibility);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
