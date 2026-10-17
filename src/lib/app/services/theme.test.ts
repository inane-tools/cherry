import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./platform', () => ({ isDesktop: () => false }));
import { applyArtworkTheme, applyCustomAccent, coordinateArtworkPresentation, setAccentSource, resetArtworkTheme } from './theme';

afterEach(() => { setAccentSource('song'); resetArtworkTheme(); });
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
