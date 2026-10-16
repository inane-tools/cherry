import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTaskbarControls } from './taskbar.mjs';
test('wires native playback buttons, paused state, and empty-player disabled state', () => {
  const actions = []; let buttons;
  const update = createTaskbarControls({ platform: 'win32', dispatch: id => actions.push(id), nativeImage: { createFromBitmap: bytes => bytes } });
  const window = { isDestroyed: () => false, setThumbarButtons: value => { buttons = value; return true; } };
  assert.equal(update(window, { hasTrack: true, playing: true }), true);
  assert.equal(buttons[1].tooltip, 'Pause');
  buttons.forEach(button => button.click()); assert.deepEqual(actions, ['prev', 'toggle', 'next']);
  update(window, { hasTrack: false, playing: false });
  assert.equal(buttons[1].tooltip, 'Play'); assert.deepEqual(buttons[0].flags, ['disabled']);
  assert.equal(buttons[0].icon.length, 32 * 32 * 4);
});
