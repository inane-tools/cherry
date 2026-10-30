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

const CONNECTION_ERRORS = {
  ERR_FAILED: 'The system network request failed', ERR_ADDRESS_UNREACHABLE: 'The server address could not be reached',
  ERR_BLOCKED_BY_CLIENT: 'Security software or a network filter blocked the request',
  ERR_BLOCKED_BY_ADMINISTRATOR: 'A system policy blocked the request',
  ERR_NAME_NOT_RESOLVED: 'DNS could not resolve the server', ENOTFOUND: 'DNS could not resolve the server', EAI_AGAIN: 'DNS lookup temporarily failed',
  ERR_CONNECTION_RESET: 'The connection was reset', ECONNRESET: 'The connection was reset',
  ERR_CONNECTION_CLOSED: 'The connection closed unexpectedly', ERR_NETWORK_CHANGED: 'The network connection changed',
  ERR_INTERNET_DISCONNECTED: 'The device is offline', ERR_CONNECTION_REFUSED: 'The connection was refused', ECONNREFUSED: 'The connection was refused',
  ERR_CONNECTION_TIMED_OUT: 'The connection timed out', ERR_TIMED_OUT: 'The connection timed out', ETIMEDOUT: 'The connection timed out',
  UND_ERR_CONNECT_TIMEOUT: 'The connection timed out',
  ERR_PROXY_CONNECTION_FAILED: 'The system proxy could not be reached', ERR_TUNNEL_CONNECTION_FAILED: 'The system proxy could not establish a connection',
  ERR_CERT_AUTHORITY_INVALID: 'The HTTPS certificate is not trusted', ERR_CERT_DATE_INVALID: 'The HTTPS certificate has an invalid date',
  ERR_CERT_COMMON_NAME_INVALID: 'The HTTPS certificate does not match the server',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'The HTTPS certificate is not trusted', UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'The HTTPS certificate is not trusted',
  SELF_SIGNED_CERT_IN_CHAIN: 'The HTTPS certificate is not trusted', DEPTH_ZERO_SELF_SIGNED_CERT: 'The HTTPS certificate is not trusted',
  CERT_HAS_EXPIRED: 'The HTTPS certificate has expired',
};
function connectionCode(error) {
  const pending = [error]; const seen = new Set();
  while (pending.length && seen.size < 24) {
    const value = pending.shift();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Object.hasOwn(CONNECTION_ERRORS, value.code)) return value.code;
    const match = String(value.message ?? '').match(/\b(?:ERR_[A-Z_]+|UND_ERR_CONNECT_TIMEOUT)\b/);
    if (match && Object.hasOwn(CONNECTION_ERRORS, match[0])) return match[0];
    pending.push(value.cause, ...(Array.isArray(value.errors) ? value.errors.slice(0, 16) : []));
  }
}

/** Use the same OS-aware networking as the login window. Explicit cookies must
 * survive, while Chromium's cookie jar must never replace the selected account.
 * Retry only transient GET/HEAD connection failures, never playlist mutations. */
export function createApiFetch(chromiumFetch, { retryDelayMs = 200 } = {}) {
  return async (value, options = {}) => {
    const url = allowedRequest(value);
    const readOnly = ['GET', 'HEAD'].includes((options.method ?? 'GET').toUpperCase());
    for (let attempt = 0; ; attempt++) {
      try {
        return await fetchAllowed(url, options, false, {
          fetchImpl: (target, init) => chromiumFetch(target.href, { ...init, credentials: 'omit', cache: 'no-store' }),
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        const code = connectionCode(error);
        if (attempt === 0 && readOnly && ['ERR_NETWORK_CHANGED', 'ERR_CONNECTION_RESET', 'ERR_CONNECTION_CLOSED', 'ECONNRESET', 'EAI_AGAIN'].includes(code)) {
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
          continue;
        }
        // Electron serializes only the message over IPC. Preserve a useful,
        // bounded diagnosis without exposing request URLs, cookies or tokens.
        throw new Error(`Network request to ${url.hostname} failed: ${code ? `${CONNECTION_ERRORS[code]} (${code})` : 'Could not establish a secure connection. Check the connection and whether security software is blocking Cherry.'}`, { cause: error });
      }
    }
  };
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
