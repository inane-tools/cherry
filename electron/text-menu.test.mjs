import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textMenuItems, installTextMenu } from './text-menu.mjs';

test('text editing menus respect edit flags and protect password selections', () => {
  const params = { isEditable: true, editFlags: { canCopy: true, canCut: true, canPaste: true, canSelectAll: true } };
  const items = textMenuItems(params);
  assert.equal(items.find(item => item.role === 'copy').enabled, true);
  assert.equal(items.find(item => item.role === 'paste').enabled, true);
  assert.equal(items.find(item => item.role === 'undo').enabled, false);
  const password = textMenuItems({ ...params, formControlType: 'input-password' });
  assert.equal(password.find(item => item.role === 'copy').enabled, false);
  assert.equal(password.find(item => item.role === 'cut').enabled, false);
  assert.equal(password.find(item => item.role === 'paste').enabled, true);
  assert.deepEqual(textMenuItems({ isEditable: false, selectionText: 'read-only', editFlags: { canCopy: true } }), [{ role: 'copy', enabled: true }]);
  assert.deepEqual(textMenuItems({ isEditable: false, selectionText: '' }), []);
});

test('opens text menus in their owning window without replacing non-text menus', () => {
  let listener;
  const window = { webContents: { on: (event, callback) => { assert.equal(event, 'context-menu'); listener = callback; } } };
  const popups = [];
  installTextMenu(window, { buildFromTemplate: items => ({ popup: options => popups.push({ items, options }) }) });
  listener({}, { isEditable: false });
  assert.equal(popups.length, 0);
  listener({}, { isEditable: true, editFlags: { canPaste: true } });
  assert.equal(popups.length, 1);
  assert.equal(popups[0].options.window, window);
});
