// Real Chromium networking with a synthetic loopback server; no user credentials.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { apiHeaders, createApiFetch } from './network.mjs';

export async function testApiTransport(chromiumFetch, cookies) {
  const server = createServer(async (request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { location: 'https://www.youtube.com/finish' }); response.end(); return;
    }
    if (request.url === '/broken') {
      response.writeHead(200, { 'content-length': '1000' });
      response.write('partial');
      setTimeout(() => response.destroy(), 20);
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'api-probe-response=must-not-save; Path=/' });
    response.end(JSON.stringify({ cookie: request.headers.cookie ?? '', authorization: request.headers.authorization ?? '',
      account: request.headers['x-goog-authuser'], channel: request.headers['x-goog-pageid'],
      origin: request.headers.origin, method: request.method, body: Buffer.concat(chunks).toString() }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const local = `http://127.0.0.1:${server.address().port}`;
  const fetchApi = createApiFetch((url, options) => chromiumFetch(local + new URL(url).pathname, options));
  try {
    await cookies.set({ url: local, name: 'api-probe-jar', value: 'must-not-send' });
    const target = 'https://music.youtube.com/probe';
    const headers = apiHeaders(target, { cookie: 'SID=synthetic-account', authorization: 'SAPISIDHASH synthetic',
      'x-goog-authuser': '2', 'x-goog-pageid': 'synthetic-channel' }, 'Cherry transport smoke');
    assert.deepEqual(await (await fetchApi(target, { method: 'POST', headers, body: '{"probe":true}' })).json(), {
      cookie: 'SID=synthetic-account', authorization: 'SAPISIDHASH synthetic', account: '2', channel: 'synthetic-channel',
      origin: 'https://www.youtube.com', method: 'POST', body: '{"probe":true}',
    });
    assert.equal((await cookies.get({ url: local, name: 'api-probe-response' })).length, 0);
    const redirected = await (await fetchApi('https://music.youtube.com/redirect', { headers })).json();
    assert.equal(redirected.cookie, '');
    assert.equal(redirected.authorization, '');
    const interrupted = await fetchApi('https://music.youtube.com/broken');
    await assert.rejects(interrupted.arrayBuffer());
    assert.equal((await (await fetchApi(target, { headers })).json()).cookie, 'SID=synthetic-account');
    assert.equal((await fetchApi(target, { method: 'HEAD' })).body, null);
  } finally {
    await cookies.remove(local, 'api-probe-jar');
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
