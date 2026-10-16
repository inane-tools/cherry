import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function createManifest(directory, version, notes = '') {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a stable release version.');
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    return (await Promise.all(entries.map(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))).flat();
  }
  const files = await walk(directory);
  const platforms = {};
  for (const [platform, suffix] of [['windows-x86_64', '-setup.exe'], ['linux-x86_64', '.AppImage']]) {
    const candidates = files.filter(f => f.endsWith(suffix));
    if (candidates.length !== 1) throw new Error(`Expected exactly one ${platform} installer, found ${candidates.length}.`);
    const installer = candidates[0];
    if (!basename(installer).includes(`_${version}_`)) throw new Error(`Installer does not match ${version}: ${installer}`);
    const signature = (await readFile(`${installer}.sig`, 'utf8')).trim();
    // Tauri signatures are base64-encoded minisign documents, not filenames.
    const decoded = Buffer.from(signature, 'base64').toString('utf8');
    if (!decoded.startsWith('untrusted comment:') || !decoded.includes('trusted comment:')) throw new Error(`Invalid signature: ${installer}`);
    platforms[platform] = { signature, url: `https://github.com/inane-tools/cherry/releases/download/v${version}/${encodeURIComponent(basename(installer))}` };
  }
  return { version, notes, pub_date: new Date().toISOString(), platforms };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, output = 'latest.json', suppliedVersion] = process.argv.slice(2);
  if (!directory) throw new Error('Usage: node scripts/updater-manifest.mjs <artifacts> [output] [version]');
  const version = suppliedVersion ?? JSON.parse(await readFile('package.json', 'utf8')).version;
  const changelog = await readFile('CHANGELOG.md', 'utf8');
  const notes = changelog.split(`## [${version}]`)[1]?.split('\n## [')[0]?.split('\n').slice(1).join('\n').trim() ?? '';
  await writeFile(output, JSON.stringify(await createManifest(directory, version, notes), null, 2) + '\n');
}
