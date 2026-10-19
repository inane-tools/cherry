// Keep legacy Tauri clients on their final signed release. Electron uses YAML.
import { readFile } from 'node:fs/promises';

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
