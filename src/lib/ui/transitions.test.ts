import { afterEach, expect, it, vi } from 'vitest';
import { fade, fly, slide, flip, menuReveal } from './transitions';
afterEach(() => { document.documentElement.className = ''; vi.unstubAllGlobals(); });

it('removes motion from every shared transition when reduced motion is requested', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const node = document.createElement('div'); document.body.append(node);
  node.style.opacity = '1'; node.style.height = '100px';
  const rects = { from: new DOMRect(0, 0, 100, 100), to: new DOMRect(0, 30, 100, 100) };
  try {
    for (const config of [fade(node, { duration: 200 }), fly(node, { y: 12 }), slide(node), flip(node, rects), menuReveal(node)]) {
      expect(config.duration).toBe(0);
      expect(config.delay).toBe(0);
    }
  } finally { node.remove(); }
});
it('uses native CSS animations for normal motion without writing inline styles', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const node = document.createElement('div'); node.style.opacity = '0.8';
  const config = fade(node, { duration: 160 });
  expect(config.duration).toBe(160);
  expect(config.css?.(0.5, 0.5)).toContain('opacity');
  expect(node.style.opacity).toBe('0.8');
});
