import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateIconStyles, iconStylesPath } from './icons.mjs';

test('every referenced Phosphor glyph exists in all three shipped weights and the generated CSS is current', async () => {
  const css = await generateIconStyles();
  assert.equal(await readFile(iconStylesPath, 'utf8'), css);
  assert.equal((css.match(/@font-face/g) ?? []).length, 3);
  assert.ok(!/https?:\/\/[^\s]+\.(woff|ttf)|\.ttf|\.svg|format\("woff"\)/.test(css));
  assert.match(css, /\.ph-fill\.ph-play:before/);
  assert.match(css, /\.ph-duotone\.ph-music-notes:after/);
  assert.match(css, /\.ph\.ph-spinner-gap:before/);
  assert.doesNotMatch(css, /Phosphor-Bold|\.ph-bold/);
});
