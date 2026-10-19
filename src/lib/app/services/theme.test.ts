import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./platform', () => ({ isDesktop: vi.fn(() => false) }));
vi.mock('$lib/desktop/core', () => ({ invoke: vi.fn() }));
import { isDesktop } from './platform';
import { invoke } from '$lib/desktop/core';
import { applyArtworkTheme, applyCustomAccent, coordinateArtworkPresentation, setAccentSource, resetArtworkTheme, previewCustomAccent, restoreStartupAppearance } from './theme';

afterEach(() => { setAccentSource('song'); resetArtworkTheme(); vi.mocked(isDesktop).mockReturnValue(false); vi.unstubAllGlobals(); });
it('waits for artwork presentation before committing a prepared theme', async () => {
  setAccentSource('song');
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const handler = vi.fn(() => ready);
  const stop = coordinateArtworkPresentation(handler);
  let finished = false;
  const request = applyArtworkTheme('art-a').then(() => { finished = true; });
  await Promise.resolve();
  expect(handler).toHaveBeenCalledWith('art-a');
  expect(finished).toBe(false);
  release(); await request;
  expect(finished).toBe(true);
  stop();
});
it('does not let a delayed artwork transition overwrite a newly chosen custom accent', async () => {
  setAccentSource('song');
  let release!: () => void;
  const stop = coordinateArtworkPresentation(() => new Promise(resolve => { release = resolve; }));
  const request = applyArtworkTheme('old-art');
  await Promise.resolve();
  setAccentSource('custom'); applyCustomAccent('#00aa55');
  const expected = document.documentElement.style.getPropertyValue('--color-accent');
  release(); await request;
  expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe(expected);
  stop();
});

it('restores the committed palette before startup without saving picker previews', () => {
  applyCustomAccent('#1266aa');
  const expected = document.documentElement.style.getPropertyValue('--color-accent');
  const snapshot = localStorage.getItem('cherry.appearance');
  previewCustomAccent('#ddaa11');
  expect(document.documentElement.style.getPropertyValue('--color-accent')).not.toBe(expected);
  expect(localStorage.getItem('cherry.appearance')).toBe(snapshot);
  restoreStartupAppearance();
  expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe(expected);
});

it('ignores a corrupt startup palette', () => {
  applyCustomAccent('#1266aa');
  const expected = document.documentElement.style.getPropertyValue('--color-accent');
  localStorage.setItem('cherry.appearance', '{broken');
  expect(() => restoreStartupAppearance()).not.toThrow();
  expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe(expected);
});


it('releases decoded theme artwork before awaiting the expanded presentation', async () => {
  vi.mocked(isDesktop).mockReturnValue(true);
  vi.mocked(invoke).mockResolvedValue('fixture');
  const image = document.createElement('img');
  image.decode = vi.fn(async () => {});
  vi.stubGlobal('Image', function () { return image; });
  let canvas: HTMLCanvasElement | undefined;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    canvas = this;
    return { drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray([200, 50, 50, 255]) }) } as unknown as CanvasRenderingContext2D;
  });
  let release!: () => void;
  const presented = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const stop = coordinateArtworkPresentation(presented);
  try {
    const request = applyArtworkTheme('resource-art');
    await vi.waitFor(() => expect(presented).toHaveBeenCalled());
    expect(image.getAttribute('src')).toBeNull();
    expect(canvas?.width).toBe(0);
    expect(canvas?.height).toBe(0);
    release(); await request;
  } finally { release?.(); stop(); }
});
