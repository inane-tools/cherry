import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllowed, apiHeaders } from './network.mjs';
const media = 'https://rr1.googlevideo.com/video?sig=a%2Bb';
test('an active transfer can outlive its connection/idle timeout', async () => {
  const response = await fetchAllowed(media, {}, true, { timeoutMs: 80, fetchImpl: async (_url, options) => new Response(new ReadableStream({
    async pull(output) {
      await new Promise(resolve => setTimeout(resolve, 20));
      if (options.signal.aborted) { output.error(Error('Aborted')); return; }
      if (++this.count >= 10) output.close(); else output.enqueue(new Uint8Array([1]));
    }, start() { this.count = 0; },
  })) });
  assert.equal((await response.arrayBuffer()).byteLength, 9);
});
test('rejects stalled headers and stalled bodies', async () => {
  await assert.rejects(fetchAllowed(media, {}, true, { timeoutMs: 10, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('Aborted')))) }));
  const response = await fetchAllowed(media, {}, true, { timeoutMs: 10, fetchImpl: async () => new Response(new ReadableStream({ pull: () => new Promise(() => {}) })) });
  await assert.rejects(response.arrayBuffer(), /stalled/);
});
test('preserves range responses and cancels upstream when the consumer stops', async () => {
  let canceled = false;
  const response = await fetchAllowed(media, { headers: { range: 'bytes=0-3' } }, true, { fetchImpl: async (url, options) => {
    assert.equal(url.search, '?sig=a%2Bb'); assert.equal(options.headers.range, 'bytes=0-3');
    return new Response(new ReadableStream({ cancel() { canceled = true; } }), { status: 206, headers: { 'content-range': 'bytes 0-3/100' } });
  } });
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 0-3/100');
  await response.body.cancel(); assert.equal(canceled, true);
});
test('rechecks redirects and strips credentials when changing origins', async () => {
  let calls = 0;
  await fetchAllowed('https://youtube.com/test', { headers: { cookie: 'private', authorization: 'private' } }, false, { fetchImpl: async (_url, options) => {
    if (++calls === 1) return new Response(null, { status: 302, headers: { location: 'https://google.com/test' } });
    assert.equal(new Headers(options.headers).has('cookie'), false);
    assert.equal(new Headers(options.headers).has('authorization'), false);
    return new Response(null, { status: 204 });
  } });
  await assert.rejects(fetchAllowed(media, {}, true, { fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'http://localhost/secret' } }) }));
});
test('uses browser defaults without overriding a requested mobile player identity', () => {
  const headers = apiHeaders('https://youtubei.googleapis.com/api', {}, 'Chrome test');
  assert.equal(headers.get('user-agent'), 'Chrome test');
  assert.equal(headers.get('origin'), 'https://music.youtube.com');
  assert.equal(apiHeaders(media, { 'user-agent': 'Android VR' }, 'Chrome').get('user-agent'), 'Android VR');
});

test('browser-side signed requests use the same origin as the authentication hash', () => {
 const headers=apiHeaders('https://www.youtube.com/youtubei/v1/account/accounts_list', { authorization:'SAPISIDHASH synthetic' }, 'Chrome');
 assert.equal(headers.get('origin'),'https://www.youtube.com');
 assert.equal(headers.get('x-origin'),'https://www.youtube.com');
});