import { afterEach, expect, it, vi } from 'vitest';
import { artwork } from './artwork';
import { hiResThumbnail, thumbnailSources } from '$lib/core/models';

afterEach(() => vi.useRealTimers());

it('tries alternate sizes, retries once, then waits for resume without looping', () => {
  vi.useFakeTimers();
  const image = document.createElement('img');
  const failed = vi.fn();
  const action = artwork(image, { urls: ['https://example.org/large', 'https://example.org/small'], onfailure: failed });
  image.dispatchEvent(new Event('error'));
  expect(image.src).toBe('https://example.org/small');
  image.dispatchEvent(new Event('error'));
  expect(image.style.visibility).toBe('hidden');
  vi.advanceTimersByTime(1500);
  expect(image.src).toBe('https://example.org/large');
  image.dispatchEvent(new Event('error'));
  image.dispatchEvent(new Event('error'));
  vi.advanceTimersByTime(10_000);
  expect(failed).toHaveBeenCalledTimes(1);
  expect(image.style.visibility).toBe('hidden');
  window.dispatchEvent(new Event('online'));
  expect(image.src).toBe('https://example.org/large');
  image.dispatchEvent(new Event('load'));
  expect(image.style.visibility).toBe('');
  action.destroy();
});

it('cancels old retries on track changes and releases resume listeners on destroy', () => {
  vi.useFakeTimers();
  const image = document.createElement('img');
  const action = artwork(image, { urls: ['https://example.org/old'] });
  image.dispatchEvent(new Event('error'));
  action.update({ urls: ['https://example.org/new'] });
  vi.advanceTimersByTime(2000);
  expect(image.src).toBe('https://example.org/new');
  image.dispatchEvent(new Event('error'));
  action.destroy();
  image.src = 'https://example.org/destroyed';
  window.dispatchEvent(new Event('focus'));
  vi.advanceTimersByTime(2000);
  expect(image.src).toBe('https://example.org/destroyed');
});

it('does not reset a successful fallback when identical options are updated', () => {
  const image = document.createElement('img');
  const options = { urls: ['https://example.org/large', 'https://example.org/small'] };
  const action = artwork(image, options);
  image.dispatchEvent(new Event('error'));
  image.dispatchEvent(new Event('load'));
  action.update(options);
  window.dispatchEvent(new Event('focus'));
  expect(image.src).toBe('https://example.org/small');
  action.destroy();
});

it('retains thumbnail variants and rewrites WebP artwork without requesting a JPEG', () => {
  expect(hiResThumbnail('https://i.ytimg.com/vi_webp/id/hqdefault.webp')).toBe('https://i.ytimg.com/vi_webp/id/maxresdefault.webp');
  expect(thumbnailSources([{ url: 'small', width: 96 }, { url: 'large', width: 512 }, { url: 'small', width: 96 }], 320)).toEqual(['large', 'small']);
});
