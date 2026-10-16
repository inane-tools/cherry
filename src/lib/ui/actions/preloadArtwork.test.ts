import { afterEach, expect, it, vi } from 'vitest';
import { preloadArtwork } from './preloadArtwork';
afterEach(() => vi.restoreAllMocks());
it('shares identical artwork and reports it after decoding', async () => {
  const image = document.createElement('img');
  image.decode = vi.fn(async () => {});
  vi.spyOn(globalThis, 'Image').mockImplementation(function () { return image; } as unknown as typeof Image);
  const ready = vi.fn();
  const urls = ['https://example.org/art'];
  const dispose = preloadArtwork([urls, [...urls]], ready);
  expect(Image).toHaveBeenCalledOnce();
  image.dispatchEvent(new Event('load'));
  await Promise.resolve();
  expect(ready).toHaveBeenCalledWith(urls, image);
  dispose();
});
it('does not promote an old cover when it is disposed during decoding', async () => {
  const image = document.createElement('img');
  let finish!: () => void;
  image.decode = () => new Promise(resolve => { finish = resolve; });
  vi.spyOn(globalThis, 'Image').mockImplementation(function () { return image; } as unknown as typeof Image);
  const ready = vi.fn();
  const dispose = preloadArtwork([['https://example.org/old']], ready);
  image.dispatchEvent(new Event('load'));
  dispose();
  finish();
  await Promise.resolve();
  expect(ready).not.toHaveBeenCalled();
});
