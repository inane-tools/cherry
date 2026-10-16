import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { allowedRequest, mediaRequest, assetPath, trustedRenderer, externalUrl } from './policy.mjs';
test('network relay accepts only HTTPS service destinations', () => {
  assert.equal(allowedRequest('https://music.youtube.com/youtubei/v1/browse').hostname, 'music.youtube.com');
  for (const url of ['http://youtube.com', 'https://youtube.com.evil.test', 'https://127.0.0.1', 'file:///etc/passwd', 'https://user:pass@youtube.com', 'https://youtube.com:8080']) assert.throws(() => allowedRequest(url));
});
test('media relay only accepts the media CDN', () => {
  assert.equal(mediaRequest('https://rr1.googlevideo.com/videoplayback?sig=a%2Bb').search, '?sig=a%2Bb');
  assert.throws(() => mediaRequest('https://music.youtube.com'));
});
test('asset paths cannot escape the packaged frontend', () => {
  const root = resolve('fixture-dist');
  assert.equal(assetPath(root, '/assets/app.js'), resolve(root, 'assets/app.js'));
  for (const path of ['/%2e%2e/secret', '/..%5csecret']) assert.throws(() => assetPath(root, path));
});
test('IPC trusts only the app renderer origin', () => {
  assert.equal(trustedRenderer('cherry://app/index.html'), true);
  assert.equal(trustedRenderer('https://music.youtube.com'), false);
  assert.equal(trustedRenderer('http://127.0.0.1:1423/', 'http://127.0.0.1:1423'), true);
  assert.equal(trustedRenderer('http://localhost:1423/', 'http://127.0.0.1:1423'), false);
});
test('external links cannot invoke file or shell protocols', () => {
  assert.equal(externalUrl('https://inane.tools'), 'https://inane.tools/');
  for (const value of ['file:///C:/Windows', 'javascript:alert(1)', 'shell:AppsFolder']) assert.throws(() => externalUrl(value));
});
