import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identityValues, prepareWindowsIdentity } from './windows-identity.mjs';
test('registers only this fork identity in the current-user app-name/icon registry', () => {
  const values = identityValues('tools.inane.cherry.electron', 'C:/Cherry/icon.png');
  assert.ok(values[0][1].startsWith('HKCU'));
  assert.ok(values[0][1].endsWith('tools.inane.cherry.electron'));
  assert.ok(values[0].includes('Cherry Electron')); assert.ok(values[1].includes('C:/Cherry/icon.png'));
  assert.throws(() => identityValues('bad/path', ''), /Invalid/);
});
test('does not register a Windows identity on Linux', async () => {
  await prepareWindowsIdentity({ platform: 'linux', run: () => { throw new Error('Unexpected registry operation'); } });
});
