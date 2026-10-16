// Synthetic local-server coverage for Chromium's real HTTP streaming backend.
// Called only by --smoke-test; never reads auth or contacts a remote service.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createMediaFetch } from './network.mjs';

export async function testMediaTransport(chromiumFetch) {
  const bytes = Buffer.alloc(512 * 1024, 0x61);
  const server = createServer((request, response) => {
    if (request.url === '/broken') {
      response.writeHead(200, { 'content-length': bytes.length * 2, connection: 'close' });
      response.write(bytes.subarray(0, 16384));
      setTimeout(() => response.destroy(), 50);
      return;
    }
    assert.equal(request.headers.range, 'bytes=0-524287');
    assert.equal(request.headers.cookie, undefined);
    response.writeHead(206, { 'content-length': bytes.length, 'content-range': 'bytes 0-524287/1048576', connection: 'close' });
    response.end(bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  // Only this test substitutes the validated googlevideo destination with its
  // own loopback server. The production adapter always fetches the original URL.
  const fetchMedia = createMediaFetch((url, options) => chromiumFetch(`http://127.0.0.1:${port}${new URL(url).pathname}`, options));
  const source = 'https://rr1.googlevideo.com/stream';
  const headers = { range: 'bytes=0-524287' };
  try {
    const response = await fetchMedia(source, { headers });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 0-524287/1048576');
    // Let the peer send FIN while the consumer is backpressured, matching the
    // reported Undici assertion. Then resume and verify the entire range.
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(Buffer.compare(Buffer.from(await response.arrayBuffer()), bytes), 0);
    for (let index = 0; index < 8; index++) {
      const controller = new AbortController();
      const active = await fetchMedia(source, { headers, signal: controller.signal });
      const reader = active.body.getReader();
      await reader.read();
      if (index % 2) controller.abort();
      await reader.cancel().catch(() => {});
    }
    const broken = await fetchMedia('https://rr1.googlevideo.com/broken');
    await assert.rejects(broken.arrayBuffer());
    // A failed/cancelled request must not poison subsequent playback.
    assert.equal((await (await fetchMedia(source, { headers })).arrayBuffer()).byteLength, bytes.length);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
