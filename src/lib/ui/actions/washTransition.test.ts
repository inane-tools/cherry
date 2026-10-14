import { afterEach, expect, it, vi } from 'vitest';
import { washTransition } from './washTransition';

afterEach(() => {
  document.documentElement.className = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('crossfades only changed backgrounds and bounds layers during rapid updates', async () => {
  let color = '#101010';
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (key: string) => key === '--color-surface' ? color : 'linear-gradient(red, blue)' }));
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const animations: Array<{ cancel: ReturnType<typeof vi.fn>; onfinish?: () => void }> = [];
  const animate = vi.fn(() => { const value = { cancel: vi.fn() }; animations.push(value); return value; });
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  const node = document.createElement('div');
  const action = washTransition(node);
  try {
    expect(node.children.length).toBe(1);
    document.documentElement.classList.add('dark');
    await Promise.resolve();
    expect(animate).not.toHaveBeenCalled();
    color = '#202020';
    document.documentElement.classList.add('light');
    await Promise.resolve();
    expect(node.children.length).toBe(2);
    expect(animate).toHaveBeenCalledTimes(1);
    color = '#303030';
    document.documentElement.classList.remove('light');
    await Promise.resolve();
    expect(node.children.length).toBe(2);
    expect(animations[0].cancel).toHaveBeenCalled();
    animations[1].onfinish?.();
    expect(node.children.length).toBe(1);
    document.documentElement.classList.add('no-accent-transition');
    color = '#404040';
    document.documentElement.classList.add('no-gradients');
    await Promise.resolve();
    expect(node.children.length).toBe(1);
    expect((node.firstElementChild as HTMLElement).style.backgroundImage).not.toBe('none');
    document.documentElement.classList.remove('no-accent-transition');
    await Promise.resolve();
    animations.at(-1)?.onfinish?.();
    expect(node.children.length).toBe(1);
    expect((node.firstElementChild as HTMLElement).style.backgroundImage).toBe('none');
  } finally {
    action.destroy();
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  }
  expect(node.children.length).toBe(0);
  expect(node.hasAttribute('data-wash-transition')).toBe(false);
});
