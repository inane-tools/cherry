import { convertFileSrc } from '@tauri-apps/api/core';
import { isTauri } from '$lib/app/services/platform';

/** DASH needs readable bytes, unlike a plain cross-origin <video src>. */
export function mediaProxyUrl(source: URL): URL {
  if (!isTauri()) return source;
  const proxy = new URL(convertFileSrc('stream', 'cherry-media'));
  proxy.searchParams.set('url', source.toString());
  return proxy;
}
