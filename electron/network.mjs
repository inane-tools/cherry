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
      try { await response.body?.cancel(); } finally { detach(); }
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
    let finished = false;
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
          // Cancellation can resolve a pending read after the consumer closed.
          if (finished) return;
          if (done) { finished = true; clear(); reader.releaseLock(); output.close(); }
          else output.enqueue(value);
        } catch (error) {
          clear(); controller.abort();
          void reader.cancel().catch(() => {});
          if (!finished) { finished = true; output.error(error); }
        }
      },
      async cancel(reason) { finished = true; clear(); controller.abort(); await reader.cancel(reason).catch(() => {}); },
    });
    const headers = new Headers(response.headers);
    // Both network backends decompress bodies. Do not advertise encoded size.
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
    // youtubei.js v18 hashes SAPISID against www.youtube.com, including for Music.
    const signed = /^SAPISIDHASH\s/.test(headers.get('authorization') ?? '');
    if (!headers.has('origin')) headers.set('origin', signed ? 'https://www.youtube.com' : 'https://music.youtube.com');
    if (signed && !headers.has('x-origin')) headers.set('x-origin', headers.get('origin'));
  }
  return headers;
}

/** Media bodies are often paused by playback buffers. Chromium owns their HTTP
 * connections, avoiding Node/Undici's paused-parser assertion on socket end.
 * Keep destination/redirect checks and abort/range handling in the shared relay.
 * No session cookies are needed: googlevideo URLs carry their own signatures. */
export function createMediaFetch(chromiumFetch) {
  return (url, options = {}) => fetchAllowed(url, options, true, {
    fetchImpl: (target, init) => chromiumFetch(target.href, { ...init, credentials: 'omit', cache: 'no-store' }),
  });
}
