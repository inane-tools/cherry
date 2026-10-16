import { afterEach, expect, it, vi } from 'vitest';
import { fade, fly, slide, flip } from './transitions';
afterEach(() => { document.documentElement.className = ''; vi.unstubAllGlobals(); });

it('removes motion from every shared transition when reduced motion is requested', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const node = document.createElement('div'); document.body.append(node);
  node.style.opacity = '1'; node.style.height = '100px';
  const rects = { from: new DOMRect(0, 0, 100, 100), to: new DOMRect(0, 30, 100, 100) };
  try {
    for (const config of [fade(node, { duration: 200 }), fly(node, { y: 12 }), slide(node), flip(node, rects)]) {
      expect(config.duration).toBe(0);
      expect(config.delay).toBe(0);
    }
  } finally { node.remove(); }
});
it('keeps Linux fades on the main thread and restores styles on cancellation', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  document.documentElement.classList.add('cherry-linux-window');
  const node = document.createElement('div'); node.style.opacity = '0.8';
  const config = fade(node, { duration: 160 });
  expect(config.css).toBeUndefined();
  config.tick?.(0.5, 0.5);
  expect(Number(node.style.opacity)).toBeCloseTo(0.4);
  config.tick?.(1, 0);
  expect(node.style.opacity).toBe('0.8');
});
