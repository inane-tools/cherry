import { afterEach, expect, it, vi } from 'vitest';
const convert = vi.hoisted(() => vi.fn(() => 'http://cherry-media.localhost/stream'));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: convert }));
import { mediaProxyUrl } from './mediaProxy';
afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; vi.clearAllMocks(); });

it('keeps browser-only playback URLs unchanged', () => {
  const url = new URL('https://rr1.googlevideo.com/video?sig=a%2Bb&n=x+y');
  expect(mediaProxyUrl(url)).toBe(url);
  expect(convert).not.toHaveBeenCalled();
});

it('routes desktop media through the native scheme without changing signed parameters', () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  const url = new URL('https://rr1.googlevideo.com/video?sig=a%2Bb&n=x+y');
  const proxy = mediaProxyUrl(url);
  expect(convert).toHaveBeenCalledWith('stream', 'cherry-media');
  expect(proxy.origin).toBe('http://cherry-media.localhost');
  expect(proxy.searchParams.get('url')).toBe(url.toString());
});
