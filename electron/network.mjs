import { allowedRequest, mediaRequest } from './policy.mjs';

/** Bound connection/idle waits, never the total duration of an active stream. */
export async function fetchAllowed(value, options = {}, media = false, { fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  let url = media ? mediaRequest(value) : allowedRequest(value);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const controller = new AbortController();
    const parent = options.signal;
    const abort = () => controller.abort(parent.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener('abort', abort, { once: true });
    const detach = () => parent?.removeEventListener('abort', abort);
    const timer = setTimeout(() => controller.abort(new Error('Network headers timed out')), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, { ...options, redirect: 'manual', signal: controller.signal });
    } catch (error) { detach(); throw error; }
    finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel(); detach();
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect has no destination');
      const next = new URL(location, url);
      if (next.origin !== url.origin) {
        const headers = new Headers(options.headers);
        headers.delete('cookie'); headers.delete('authorization');
        options = { ...options, headers };
      }
      url = media ? mediaRequest(next) : allowedRequest(next);
      if (response.status === 303 || ([301, 302].includes(response.status) && options.method === 'POST')) {
        options = { ...options, method: 'GET', body: undefined };
      }
      continue;
    }
    if (!response.body) { detach(); return response; }
    const reader = response.body.getReader();
    let idle;
    const clear = () => { clearTimeout(idle); detach(); };
    const body = new ReadableStream({
      async pull(output) {
        let rejectIdle;
        const deadline = new Promise((_resolve, reject) => { rejectIdle = reject; });
        idle = setTimeout(() => {
          controller.abort();
          rejectIdle(new Error('Network body stalled'));
        }, timeoutMs);
        try {
          const { value, done } = await Promise.race([reader.read(), deadline]);
          clearTimeout(idle);
          if (done) { clear(); output.close(); }
          else output.enqueue(value);
        } catch (error) {
          clear(); controller.abort();
          void reader.cancel().catch(() => {});
          output.error(error);
        }
      },
      async cancel(reason) { clear(); controller.abort(); await reader.cancel(reason).catch(() => {}); },
    });
    const headers = new Headers(response.headers);
    // Node fetch already decompresses the body. Do not advertise encoded size.
    if (headers.has('content-encoding')) { headers.delete('content-encoding'); headers.delete('content-length'); }
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  }
  throw new Error('Too many network redirects');
}

export function apiHeaders(value, input, userAgent) {
  const url = allowedRequest(value);
  const headers = new Headers(input);
  for (const name of ['host', 'connection', 'content-length', 'transfer-encoding', 'upgrade']) headers.delete(name);
  if (!headers.has('user-agent')) headers.set('user-agent', userAgent);
  if (['youtube.com', 'google.com', 'googleapis.com', 'googlevideo.com', 'ytimg.com', 'ggpht.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host))) {
    if (!headers.has('origin')) headers.set('origin', 'https://music.youtube.com');
  }
  return headers;
}
