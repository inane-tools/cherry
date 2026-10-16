import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPlaylistImageUpload, uploadAuthorization } from './playlist-image.mjs';
const bytes = Buffer.from([255, 216, 255, 1, 2, 3]);
const args = { cookie: 'SID=test; __Secure-3PAPISID=signing', dataBase64: bytes.toString('base64'), mime: 'image/jpeg', accountIndex: 2, channelId: 'brand-page' };
test('signs playlist uploads against the Music origin and supports secure cookies', () => {
  const hash = createHash('sha1').update('1000 signing https://music.youtube.com').digest('hex');
  assert.equal(uploadAuthorization(args.cookie, 1000), 'SAPISIDHASH 1000_' + hash);
});
test('uploads the bytes and finalizes with the selected account and brand identity', async () => {
  const requests = [];
  const upload = createPlaylistImageUpload({ now: () => 1000, fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return requests.length === 1 ? new Response('', { headers: { 'x-goog-upload-url': 'https://music.youtube.com/playlist_image_upload/session?upload_id=test' } }) : Response.json({ encryptedBlobId: 'encrypted-image' });
  } });
  assert.equal(await upload(args), 'encrypted-image');
  assert.equal(requests[0].options.body, 'filename=cherry-playlist.jpg');
  assert.deepEqual(requests[1].options.body, bytes);
  for (const { options } of requests) {
    assert.equal(options.headers['x-goog-authuser'], '2'); assert.equal(options.headers['x-goog-pageid'], 'brand-page');
    assert.equal(options.redirect, 'error'); assert.equal(options.headers.origin, 'https://music.youtube.com');
  }
  assert.equal(requests[1].options.headers['x-goog-upload-command'], 'upload, finalize');
});
test('refuses a session URL outside the upload hosts before sending credentials or bytes', async () => {
  let requests = 0;
  const upload = createPlaylistImageUpload({ fetchImpl: async () => { requests++; return new Response('', { headers: { 'x-goog-upload-url': 'https://example.com/steal' } }); } });
  await assert.rejects(upload(args), /Refused playlist upload/); assert.equal(requests, 1);
});
test('reports rejected uploads and rejects invalid data before starting', async () => {
  const upload = createPlaylistImageUpload({ fetchImpl: async () => new Response('', { status: 403 }) });
  await assert.rejects(upload(args), /HTTP 403/);
  await assert.rejects(upload({ ...args, dataBase64: '' }), /image data/);
  await assert.rejects(upload({ ...args, mime: 'text/html' }), /Invalid playlist image/);
  await assert.rejects(upload({ ...args, cookie: 'SID=test' }), /signing cookie/);
});
