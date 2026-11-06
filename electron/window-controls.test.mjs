import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseButtonLayout, kdeButtonLayout, windowControlLayout } from './window-controls.mjs';

test('reads left, right and split GTK layouts without duplicate or unsupported buttons', () => {
  assert.deepEqual(parseButtonLayout("'close,minimize,maximize:menu'"), { left: ['close', 'minimize', 'maximize'], right: [] });
  assert.deepEqual(parseButtonLayout('close:minimize,maximize,close,menu'), { left: ['close'], right: ['minimize', 'maximize'] });
  assert.equal(parseButtonLayout('invalid'), null);
  assert.deepEqual(parseButtonLayout('menu:'), { left: [], right: [] });
  assert.equal(parseButtonLayout('invalid:unknown'), null);
});
test('reads KDE layout from only the decoration section, including empty sides', () => {
  assert.deepEqual(kdeButtonLayout('[Other]\nButtonsOnLeft=I\n[org.kde.kdecoration2]\nButtonsOnLeft=XA\nButtonsOnRight=I\n[Other2]\nButtonsOnRight=X'), { left: ['close', 'maximize'], right: ['minimize'] });
  assert.deepEqual(kdeButtonLayout('[org.kde.kdecoration2]\nButtonsOnLeft=XAI\nButtonsOnRight=\n'), { left: ['close', 'maximize', 'minimize'], right: [] });
});
test('uses KDE preferences without consulting unrelated GNOME settings', async () => {
  const layout = await windowControlLayout({ platform: 'linux', env: { XDG_CURRENT_DESKTOP: 'KDE', XDG_CONFIG_HOME: '/config' },
    read: async path => { assert.match(path, /kwinrc$/); return '[org.kde.kdecoration2]\nButtonsOnLeft=XAI\nButtonsOnRight=\n'; },
    run: () => { throw Error('Must not query gsettings on KDE'); } });
  assert.equal(layout.left[0], 'close');
});
test('uses bounded GNOME queries and falls back safely when preferences are unavailable', async () => {
  assert.deepEqual(await windowControlLayout({ platform: 'linux', env: {}, run: async (_command, args, options) => {
    assert.deepEqual(args, ['get', 'org.gnome.desktop.wm.preferences', 'button-layout']);
    assert.equal(options.timeout, 1000); return { stdout: "'close:'" };
  } }), { left: ['close'], right: [] });
  assert.deepEqual(await windowControlLayout({ platform: 'linux', env: {}, read: async () => { throw Error('missing'); }, run: async () => { throw Error('missing'); } }), { left: [], right: ['minimize', 'maximize', 'close'] });
  assert.deepEqual(await windowControlLayout({ platform: 'win32', run: () => { throw Error('No helper needed'); } }), { left: [], right: ['minimize', 'maximize', 'close'] });
});
