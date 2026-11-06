import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createLinuxWindow } from './linux-window.mjs';

test('keeps rounded content across frame changes and squares maximized/fullscreen content', () => {
  const frames = [];
  let view;
  class NativeWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options;
      this.contentView = { addChildView() {}, removeChildView() {} };
      frames.push(this);
    }
    getContentSize() { return [1000, 700]; }
    getNormalBounds() { return { x: 10, y: 20, width: 1000, height: 700 }; }
    isDestroyed() { return !!this.destroyed; }
    isMaximized() { return !!this.maximized; }
    isFullScreen() { return !!this.fullscreen; }
    isAlwaysOnTop() { return false; }
    isVisible() { return false; }
    isMinimized() { return false; }
    setMenuBarVisibility() {}
    maximize() { this.maximized = true; this.emit('maximize'); }
    setFullScreen(value) { this.fullscreen = value; this.emit(value ? 'enter-full-screen' : 'leave-full-screen'); }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  class ContentView {
    constructor() {
      view = this;
      this.webContents = { isDestroyed: () => false, close: () => { this.closed = true; } };
    }
    setBackgroundColor(color) { this.color = color; }
    setBounds(bounds) { this.bounds = bounds; }
    setBorderRadius(radius) { this.radius = radius; }
  }
  const controller = createLinuxWindow({ BaseWindow: NativeWindow, WebContentsView: ContentView,
    options: { backgroundColor: '#050505' }, controlsVisible: true, onCreated() {} });
  const contents = frames[0].webContents;
  assert.ok(view.radius > 0);
  const radius = view.radius;
  frames[0].maximize();
  assert.equal(view.radius, 0);
  frames[0].maximized = false;
  frames[0].emit('unmaximize');
  assert.equal(view.radius, radius);
  frames[0].setFullScreen(true);
  assert.equal(view.radius, 0);
  frames[0].setFullScreen(false);
  assert.equal(view.radius, radius);
  for (const visible of [false, true]) {
    controller.setVisible(visible);
    const frame = frames.at(-1);
    assert.equal(frame.webContents, contents, 'frame replacement preserves the page');
    assert.equal(frame.options.roundedCorners, true);
    assert.equal(view.radius, radius);
    assert.equal(view.closed, undefined, 'retired frame cannot close playback');
  }
  frames[0].maximized = true;
  frames[0].emit('resize');
  assert.equal(view.radius, radius, 'retired frame cannot overwrite current clipping');
  frames.at(-1).destroy();
  assert.equal(view.closed, true);
});
