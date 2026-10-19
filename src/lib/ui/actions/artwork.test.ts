import { afterEach, expect, it, vi } from 'vitest';
import { artwork } from './artwork';
import { hiResThumbnail, thumbnailSources, expandedArtworkSources } from '$lib/core/models';

it.each(['iqc0lqW6AEY', 'xXF7qHZXJ4w', 'SfNPOwFRRJs'])('rejects the decoded YouTube placeholder for %s without promoting it', id => {
  const image = document.createElement('img');
  const urls = expandedArtworkSources([{ url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 480 }]);
  const action = artwork(image, { urls });
  const promoted = vi.fn();
  image.addEventListener('load', promoted);
  Object.defineProperties(image, { naturalWidth: { configurable: true, value: 120 }, naturalHeight: { configurable: true, value: 90 } });
  image.dispatchEvent(new Event('load'));
  expect(promoted).not.toHaveBeenCalled();
  expect(image.src).toBe(`https://i.ytimg.com/vi/${id}/sddefault.jpg`);
  Object.defineProperties(image, { naturalWidth: { value: 640 }, naturalHeight: { value: 480 } });
  image.dispatchEvent(new Event('load'));
  expect(promoted).toHaveBeenCalledTimes(1);
  action.destroy();
});

it('retains real maximum-resolution artwork and does not downgrade Google album art', () => {
  const image = document.createElement('img');
  const urls = expandedArtworkSources([{ url: 'https://i.ytimg.com/vi/id/hqdefault.jpg', width: 480 }]);
  const action = artwork(image, { urls });
  Object.defineProperties(image, { naturalWidth: { value: 1280 }, naturalHeight: { value: 720 } });
  image.dispatchEvent(new Event('load'));
  expect(image.src).toBe('https://i.ytimg.com/vi/id/maxresdefault.jpg');
  expect(expandedArtworkSources([{ url: 'https://lh3.googleusercontent.com/art=w544-h544', width: 544 }])[0]).toContain('=w1080-h1080');
  action.destroy();
});

afterEach(() => vi.useRealTimers());

it('shares global resume listeners only while failed images need them', () => {
  vi.useFakeTimers();
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  const images = Array.from({ length: 100 }, () => document.createElement('img'));
  const actions = images.map(image => artwork(image, { urls: ['https://example.org/art'] }));
  try {
    const onlineAdds = () => add.mock.calls.filter(([event]) => event === 'online').length;
    expect(onlineAdds()).toBe(0);
    images[0].dispatchEvent(new Event('error'));
    images[1].dispatchEvent(new Event('error'));
    expect(onlineAdds()).toBe(1);
    actions[0].destroy();
    expect(remove.mock.calls.filter(([event]) => event === 'online')).toHaveLength(0);
    images[1].dispatchEvent(new Event('load'));
    expect(remove.mock.calls.filter(([event]) => event === 'online')).toHaveLength(1);
  } finally { actions.forEach(action => action.destroy()); }
});

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
