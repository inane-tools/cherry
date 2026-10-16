import { afterEach, expect, it, vi } from 'vitest';
import { lyricHighlight } from './lyricHighlight';
afterEach(() => vi.unstubAllGlobals());
it('animates only changed lyric states and cleans up its frame', () => {
  const request = vi.fn(() => 1);
  const cancel = vi.fn();
  vi.stubGlobal('requestAnimationFrame', request);
  vi.stubGlobal('cancelAnimationFrame', cancel);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const action = lyricHighlight(document.createElement('button'), false);
  action.update(false);
  expect(request).not.toHaveBeenCalled();
  action.update(true);
  expect(request).toHaveBeenCalledOnce();
  action.update(true);
  expect(request).toHaveBeenCalledOnce();
  action.destroy();
  expect(cancel).toHaveBeenLastCalledWith(1);
});
it('respects reduced motion without starting an animation', () => {
  const request = vi.fn();
  vi.stubGlobal('requestAnimationFrame', request);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const action = lyricHighlight(document.createElement('button'), false);
  action.update(true);
  expect(request).not.toHaveBeenCalled();
  action.destroy();
});
