import { Readable } from 'node:stream';

/** Fetch-shaped adapter over Electron net.request. Unlike net.fetch's manual
 * redirect mode, expose the redirect response so our relay can validate every
 * destination before connecting. Never use or populate the session cookie jar. */
export function createChromiumFetch(request) {
  return (url, options = {}) => new Promise((resolve, reject) => {
    const signal = options.signal;
    if (signal?.aborted) { reject(signal.reason); return; }
    const req = request({ url, method: options.method ?? 'GET', redirect: 'manual',
      useSessionCookies: false, credentials: 'omit', cache: 'no-store' });
    let incoming;
    let settled = false;
    const fail = error => {
      if (settled) incoming?.destroy(error);
      else { settled = true; reject(error); }
    };
    const abort = () => {
      fail(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      req.abort();
    };
    const detach = () => signal?.removeEventListener('abort', abort);
    req.on('error', fail);
    req.on('close', detach);
    req.on('redirect', (status, _method, location, rawHeaders) => {
      if (settled) return;
      settled = true;
      const headers = responseHeaders(rawHeaders);
      headers.set('location', location);
      resolve(new Response(null, { status, headers }));
      req.abort();
    });
    req.on('response', response => {
      if (settled) { response.resume(); return; }
      incoming = response;
      // Null-body responses are drained rather than wrapped by Readable.toWeb;
      // they still need an error listener if their connection closes early.
      response.on('error', error => { if (!settled) fail(error); });
      // A truncated Chromium response emits aborted, rather than a Readable
      // error. Propagate that to the consumer instead of waiting indefinitely.
      response.on('aborted', () => response.destroy(new Error('Network response was interrupted')));
      response.on('close', () => { if (!response.readableEnded) req.abort(); });
      const body = options.method === 'HEAD' || [204, 205, 304].includes(response.statusCode)
        ? null : Readable.toWeb(response);
      try {
        const result = new Response(body, { status: response.statusCode, statusText: response.statusMessage,
          headers: responseHeaders(response.headers) });
        settled = true;
        resolve(result);
        if (!body) response.resume();
      } catch (error) { fail(error); req.abort(); }
    });
    signal?.addEventListener('abort', abort, { once: true });
    try {
      for (const [name, value] of new Headers(options.headers)) req.setHeader(name, value);
      if (options.body != null) req.write(options.body);
      req.end();
    } catch (error) { fail(error); detach(); req.abort(); }
  });
}

function responseHeaders(raw = {}) {
  const headers = new Headers();
  for (const [name, values] of Object.entries(raw)) {
    for (const value of Array.isArray(values) ? values : [values]) headers.append(name, value);
  }
  return headers;
}
