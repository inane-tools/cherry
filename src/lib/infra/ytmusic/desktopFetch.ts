// CORS-free fetch for youtubei.js inside Electron.
// The Chromium renderer blocks direct `fetch` to Google origins (CORS), so
// every Innertube request (session, player JS, API, OAuth) is relayed
// through the Electron `http_proxy_fetch` command (reqwest, no origin checks)
// and re-wrapped as a real `Response`. Outside Electron (plain browser dev /
// Node) the platform default fetch is used.

import { isDesktop } from '$lib/app/services/platform';

interface ProxyResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function collectHeaders(into: Record<string, string>, h: unknown): void {
  if (!h) return;
  if (typeof (h as Headers).forEach === 'function') {
    (h as Headers).forEach((v, k) => {
      into[k] = v;
    });
  } else if (Array.isArray(h)) {
    for (const [k, v] of h as [string, string][]) into[k] = v;
  } else if (typeof h === 'object') {
    for (const [k, v] of Object.entries(h as Record<string, string>)) into[k] = String(v);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function proxiedFetch(input: any, init?: any): Promise<Response> {
  const url = String(input?.url ?? input);
  const method = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = {};
  collectHeaders(headers, input?.headers);
  collectHeaders(headers, init?.headers);

  let body: string | null = null;
  const rawBody = init?.body ?? input?.body;
  if (typeof rawBody === 'string') {
    body = rawBody;
  } else if (rawBody != null) {
    body = await new Response(rawBody).text();
  }

  const { invoke } = await import('$lib/desktop/core');
  // NOTE: the Electron relay adds a browser-style `Origin` header for Google
  // hosts. youtubei.js only sets it on its "server" shim, and without it some
  // endpoints (e.g. accounts_list) return a degraded body.
  const res = await invoke<ProxyResult>('http_proxy_fetch', { url, method, headers, body });
  return new Response(res.body, { status: res.status, headers: res.headers });
}

/** Fetch implementation for `Innertube.create({ fetch })`. */
export function innertubeFetch(): typeof fetch | undefined {
  if (!isDesktop()) return undefined;
  return proxiedFetch as unknown as typeof fetch;
}
