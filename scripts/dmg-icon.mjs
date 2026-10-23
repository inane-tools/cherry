// Reuse the Windows installer artwork for the macOS disk image only.
import { convertIcon } from 'app-builder-lib/out/util/iconConverter.js';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'release', '.dmg-icon');
const result = await convertIcon({ sources: ['install-cherry.png'], fallbackSources: [], roots: [root], format: 'icns', outDir: output });
if (result.error || result.icons.length !== 1) throw new Error(result.error || 'DMG icon conversion failed');
await mkdir(join(root, 'release', '.installer-icon'), { recursive: true });
await copyFile(result.icons[0].file, join(root, 'release', '.installer-icon', 'install-cherry.icns'));
console.log('DMG icon: install-cherry.png -> release/.installer-icon/install-cherry.icns');
