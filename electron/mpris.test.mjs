import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('KDE-style D-Bus property writes control shuffle, loop, playback and seeking', { skip: process.platform !== 'linux' }, async () => {
  const { stdout } = await promisify(execFile)('dbus-run-session', ['--', process.execPath,
    fileURLToPath(new URL('./mpris.smoke.mjs', import.meta.url))], { timeout: 15000 });
  assert.match(stdout, /MPRIS_SMOKE_PASS/);
});
