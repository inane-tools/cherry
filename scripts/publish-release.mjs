// Validate the updater feed against the exact files before making a release public.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { releaseCodename } from '../src/lib/app/services/release.ts';
import { loadTauriCompatibility } from './tauri-compatibility.mjs';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
// Use the same YAML parser dependency as the updater whose feed is being verified.
const requireUpdater = createRequire(import.meta.resolve('electron-updater'));
const { load } = requireUpdater('js-yaml');
const folder = resolve(process.argv[2] || 'release-assets');
const tag = `v${pkg.version}`;
const feed = pkg.build.publish[0];
const repo = `${feed.owner}/${feed.repo}`;
if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY !== repo) throw new Error('Repository does not match updater feed');
if (process.env.GITHUB_REF?.startsWith('refs/tags/') && process.env.GITHUB_REF !== `refs/tags/${tag}`) throw new Error('Tag does not match package version');
const expected = [
  `Cherry-Setup-${pkg.version}-x64.exe`,
  `Cherry-Setup-${pkg.version}-x64.exe.blockmap`,
  'latest.yml',
  `Cherry-${pkg.version}-x86_64.AppImage`,
  'latest-linux.yml',
  `Cherry-${pkg.version}-x86_64.flatpak`,
  `Cherry-${pkg.version}-mac-arm64.dmg`,
  `Cherry-${pkg.version}-mac-x64.dmg`,
];
// Existing Tauri clients still request latest.json from the canonical repository.
// Keep them on their final signed Tauri release while Electron uses latest*.yml.
const legacyManifest = await loadTauriCompatibility(new URL('../build/tauri-latest.json', import.meta.url));
await writeFile(resolve(folder, 'latest.json'), legacyManifest);
expected.push('latest.json');
const files = await readdir(folder);
for (const file of expected) {
  if (!files.includes(file) || (await stat(resolve(folder, file))).size === 0) throw new Error(`Missing/empty release asset: ${file}`);
}
const optional = `Cherry-${pkg.version}-x86_64.AppImage.blockmap`;
if (files.includes(optional)) expected.push(optional);
if (files.some((file) => !expected.includes(file))) throw new Error('Unexpected files in release assets');
for (const [metadata, binary] of [['latest.yml', expected[0]], ['latest-linux.yml', expected[3]]]) {
  const doc = load(await readFile(resolve(folder, metadata), 'utf8'));
  if (String(doc.version) !== pkg.version || doc.path !== binary) throw new Error(`Incorrect version/path in ${metadata}`);
  const entry = doc.files?.find((item) => item.url === binary);
  if (!entry) throw new Error(`Missing updater file in ${metadata}`);
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(resolve(folder, binary))) hash.update(chunk);
  const checksum = hash.digest('base64');
  if (entry.sha512 !== checksum || doc.sha512 !== checksum || entry.size !== (await stat(resolve(folder, binary))).size) throw new Error(`Updater checksum/size mismatch: ${binary}`);
}
const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const section = changelog.split(`## [${pkg.version}]`)[1]?.split('\n## [')[0];
if (!section || section.split('\n')[0].includes('Unreleased')) throw new Error('Missing dated changelog entry');
let notes = section.slice(section.indexOf('\n')).trim();
try { notes = (await readFile(new URL(`../docs/releases/${pkg.version}.md`, import.meta.url), 'utf8')).trim(); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const notesFile = resolve(tmpdir(), `cherry-release-${process.env.GITHUB_RUN_ID || 'local'}.md`);
await writeFile(notesFile, `${notes}\n\nWindows: use the NSIS setup executable. Linux: use AppImage or install the Flatpak bundle. macOS: use the arm64 DMG for Apple Silicon or x64 DMG for Intel, then drag Cherry into Applications. macOS builds are ad-hoc signed and are not notarized; Gatekeeper may require approval in System Settings → Privacy & Security. macOS and Flatpak updates are manual; Windows and AppImage use Cherry’s GitHub updater.\n`);
console.log(`Verified ${expected.length} assets for ${repo} ${tag}`);
if (process.argv.includes('--check')) process.exit(0);
if (!process.env.GH_TOKEN || !process.env.GITHUB_SHA) throw new Error('Publication requires GitHub Actions release credentials and commit');
function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'GitHub CLI failed');
  return result.stdout;
}
let existing;
const lookup = spawnSync('gh', ['release', 'view', tag, '--repo', repo, '--json', 'isDraft,targetCommitish'], { encoding: 'utf8' });
if (lookup.status === 0) existing = JSON.parse(lookup.stdout);
if (existing && !existing.isDraft) throw new Error('Release is already published; refusing to replace updater assets');
if (!existing) gh(['release', 'create', tag, '--repo', repo, '--target', process.env.GITHUB_SHA, '--title', `${tag} ${releaseCodename(pkg.version)}`, '--notes-file', notesFile, '--draft']);
gh(['release', 'upload', tag, '--repo', repo, '--clobber', ...expected.map((file) => resolve(folder, basename(file)))]);
gh(['release', 'edit', tag, '--repo', repo, '--title', `${tag} ${releaseCodename(pkg.version)}`, '--notes-file', notesFile, '--draft=false', '--latest']);
console.log(`Published https://github.com/${repo}/releases/tag/${tag}`);
