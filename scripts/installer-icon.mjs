// Convert the supplied artwork to Windows ICO using electron-builder's toolset.
// The app icon is deliberately independent of the setup/progress-window icon.
import { convertIcon } from 'app-builder-lib/out/util/iconConverter.js';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'release', '.installer-icon');
const result = await convertIcon({ sources: ['install-cherry.png'], fallbackSources: [], roots: [root], format: 'ico', outDir: output });
if (result.error || result.icons.length !== 1) throw new Error(result.error || 'Installer icon conversion failed');
await mkdir(join(root, 'build'), { recursive: true });
await copyFile(result.icons[0].file, join(root, 'build', 'install-cherry.ico'));
console.log('Installer icon: install-cherry.png -> build/install-cherry.ico');
