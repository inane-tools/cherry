import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { installMacWindowControls, macTrafficLightPosition, windowChrome } from './macos.mjs';

const nextLayout = () => new Promise(resolve => setImmediate(resolve));
function nativeWindow() {
  const window = new EventEmitter();
  Object.assign(window, {
    zoom: 1.1, fullscreen: false, destroyed: false, visibilityWrites: 0,
    position: null,
    webContents: { getZoomFactor: () => window.zoom },
    isDestroyed: () => window.destroyed,
    isFullScreen: () => window.fullscreen,
    setWindowButtonPosition: position => { window.position = position; },
    setWindowButtonVisibility: () => {
      window.visibilityWrites++;
      window.position = { x: 7, y: 7 }; // Native titlebar resets on visibility changes.
    },
  });
  return window;
}

test('recovers native layout resets after showing, restoring, resizing and leaving fullscreen', async () => {
  const window = nativeWindow();
  const controls = installMacWindowControls(window);
  controls.setVisible(true);
  await nextLayout();
  for (const event of ['ready-to-show', 'show', 'focus', 'restore', 'resize', 'leave-full-screen']) {
    window.position = { x: 7, y: 7 };
    window.emit(event);
    await nextLayout();
    assert.deepEqual(window.position, macTrafficLightPosition(window.zoom), event);
  }
  controls.setVisible(true);
  assert.equal(window.visibilityWrites, 1, 'unrelated settings saves do not reset native controls');
  controls.setVisible(false);
  controls.setVisible(true);
  await nextLayout();
  assert.deepEqual(window.position, macTrafficLightPosition(window.zoom));
});

test('uses the current zoom after deferred layout and leaves fullscreen controls to macOS', async () => {
  const window = nativeWindow();
  const controls = installMacWindowControls(window);
  controls.refresh();
  window.zoom = 2.2;
  await nextLayout();
  assert.deepEqual(window.position, macTrafficLightPosition(2.2));
  window.fullscreen = true;
  window.position = null;
  window.emit('resize');
  await nextLayout();
  assert.equal(window.position, null);
  window.fullscreen = false;
  window.emit('leave-full-screen');
  await nextLayout();
  assert.deepEqual(window.position, macTrafficLightPosition(2.2));
  window.emit('focus');
  window.destroyed = true;
  window.emit('closed');
  await nextLayout();
});

test('uses native controls on macOS and Linux while preserving Windows renderer captions', () => {
  assert.equal(windowChrome('darwin').titleBarStyle, 'hidden');
  assert.deepEqual(windowChrome('win32'), { frame: false });
  assert.deepEqual(windowChrome('linux'), {
    frame: true, titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', height: 48 },
  });
  assert.equal(windowChrome('linux', false).titleBarOverlay, false);
});
