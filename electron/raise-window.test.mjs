import { test } from 'node:test';
import assert from 'node:assert/strict';
import { raiseWindow } from './raise-window.mjs';

const fakeWindow = ({ minimized = false, destroyed = false } = {}) => {
  const calls = [];
  return {
    calls,
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
  };
};

test('restores a minimized window before showing it', () => {
  const window = fakeWindow({ minimized: true });
  raiseWindow(window);
  assert.deepEqual(window.calls, ['restore', 'show', 'focus']);
});

test('shows a hidden or background window without restoring', () => {
  const window = fakeWindow();
  raiseWindow(window);
  assert.deepEqual(window.calls, ['show', 'focus']);
});

test('ignores a missing or destroyed window', () => {
  assert.doesNotThrow(() => raiseWindow(undefined));
  const window = fakeWindow({ destroyed: true, minimized: true });
  raiseWindow(window);
  assert.deepEqual(window.calls, []);
});
