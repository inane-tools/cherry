import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllowed, apiHeaders, createApiFetch, createMediaFetch } from './network.mjs';
const media = 'https://rr1.googlevideo.com/video?sig=a%2Bb';

test('API requests use Chromium while preserving explicit session identity and request bodies', async () => {
  const api = createApiFetch(async (url, options) => {
    assert.equal(url, 'https://music.youtube.com/youtubei/v1/browse');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'manual');
    const headers = new Headers(options.headers);
    assert.equal(headers.get('cookie'), 'SID=synthetic');
    assert.equal(headers.get('authorization'), 'SAPISIDHASH synthetic');
    assert.equal(headers.get('x-goog-authuser'), '2');
    assert.equal(headers.get('x-goog-pageid'), 'brand-channel');
    assert.equal(options.body, '{"browseId":"FEmusic_home"}');
    return new Response('{"ok":true}', { status: 200 });
  });
  const response = await api('https://music.youtube.com/youtubei/v1/browse', { method: 'POST',
    headers: { cookie: 'SID=synthetic', authorization: 'SAPISIDHASH synthetic', 'x-goog-authuser': '2', 'x-goog-pageid': 'brand-channel' },
    body: '{"browseId":"FEmusic_home"}' });
  assert.deepEqual(await response.json(), { ok: true });
});

test('API transport retries one transient read failure but never replays mutations', async () => {
  let calls = 0;
  const api = createApiFetch(async () => {
    if (++calls === 1) throw Error('net::ERR_CONNECTION_RESET');
    return new Response('ok');
  }, { retryDelayMs: 0 });
  assert.equal(await (await api('https://www.youtube.com/sw.js_data')).text(), 'ok');
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(api('https://music.youtube.com/youtubei/v1/playlist/edit', { method: 'POST', body: '{}' }), /ERR_CONNECTION_RESET/);
  assert.equal(calls, 1);
});

test('API error diagnostics preserve DNS/TLS codes without exposing credentials or signed URLs', async () => {
  for (const error of [
    new Error('net::ERR_CERT_AUTHORITY_INVALID'),
    new TypeError('fetch failed', { cause: Object.assign(new Error('private diagnostic'), { code: 'ENOTFOUND' }) }),
  ]) {
    const api = createApiFetch(async () => { throw error; });
    await assert.rejects(api('https://www.youtube.com/test?token=secret', { headers: { cookie: 'SID=private' } }), failure => {
      assert.match(failure.message, /www\.youtube\.com/);
      assert.match(failure.message, /ERR_CERT_AUTHORITY_INVALID|ENOTFOUND/);
      assert.doesNotMatch(failure.message, /secret|private|token|SID/);
      return true;
    });
  }
});

test('API transport keeps destination validation, HTTP errors and cancellation intact', async () => {
  let calls = 0;
  const api = createApiFetch(async () => { calls++; return new Response('denied', { status: 403 }); });
  await assert.rejects(api('file:///private'), /Refused/);
  assert.equal(calls, 0);
  assert.equal((await api('https://music.youtube.com/test')).status, 403);
  assert.equal(calls, 1);
  const controller = new AbortController(); controller.abort();
  const aborted = createApiFetch(async () => { throw new DOMException('Cancelled', 'AbortError'); });
  await assert.rejects(aborted('https://music.youtube.com/test', { signal: controller.signal }), { name: 'AbortError' });
});
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
test('media uses the supplied Chromium transport with ranges and no cookie jar', async () => {
  let calls = 0;
  const nativeFetch = createMediaFetch(async (url, options) => {
    calls++;
    assert.equal(typeof url, 'string');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'manual');
    assert.equal(new Headers(options.headers).get('range'), 'bytes=0-3');
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 206 });
  });
  assert.equal((await (await nativeFetch(media, { headers: { range: 'bytes=0-3' } })).arrayBuffer()).byteLength, 4);
  await assert.rejects(nativeFetch('https://youtube.com/not-media'), /Refused media/);
  assert.equal(calls, 1);
});

test('cancel while a body read is pending releases the upstream without stream-controller errors', async () => {
  let canceled = 0;
  const response = await fetchAllowed(media, {}, true, { fetchImpl: async () => new Response(new ReadableStream({
    pull: () => new Promise(() => {}), cancel: () => { canceled++; },
  })) });
  const reader = response.body.getReader();
  const pending = reader.read();
  await reader.cancel();
  assert.equal((await pending).done, true);
  assert.equal(canceled, 1);
});

test('an interrupted body rejects consumption and a later request can still succeed', async () => {
  const response = await fetchAllowed(media, {}, true, { fetchImpl: async () => new Response(new ReadableStream({
    start(output) { output.enqueue(new Uint8Array([1])); },
    pull(output) { output.error(new Error('Connection closed')); },
  })) });
  await assert.rejects(response.arrayBuffer(), /Connection closed/);
  const next = await fetchAllowed(media, {}, true, { fetchImpl: async () => new Response('ok') });
  assert.equal(await next.text(), 'ok');
});
