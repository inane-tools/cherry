import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTauriManifest, loadTauriCompatibility } from './tauri-compatibility.mjs';

test('legacy manifest stays pinned to signed Tauri binaries in the preserved repository', () => {
  const doc = { version: '1.7.0', platforms: { 'windows-x86_64': { url: 'https://github.com/inane-tools/cherry-tauri/releases/download/v1.7.0/Cherry_1.7.0_x64-setup.exe', signature: 'synthetic-signature'.repeat(4) } } };
  assert.equal(validateTauriManifest(doc), doc);
  assert.throws(() => validateTauriManifest({ ...doc, version: '2.0.0' }));
  assert.throws(() => validateTauriManifest({ ...doc, platforms: { x: { ...doc.platforms['windows-x86_64'], url: 'https://example.com/setup.exe' } } }));
  assert.throws(() => validateTauriManifest({ ...doc, platforms: { x: { ...doc.platforms['windows-x86_64'], signature: '' } } }));
});

test('loads and validates the manifest used by the release publisher', async () => {
  const bytes = await loadTauriCompatibility(new URL('../build/tauri-latest.json', import.meta.url));
  assert.equal(JSON.parse(bytes).version, '1.7.0');
});
