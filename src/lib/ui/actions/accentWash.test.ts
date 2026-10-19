import { afterEach, expect, it, vi } from 'vitest';
import { accentWash } from './accentWash';

afterEach(() => { document.documentElement.className = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('crossfades committed colours and the setting, but suppresses washes immediately on banner pages', async () => {
  let accent = '#ff4d5e';
  const styles = vi.fn(() => ({ getPropertyValue: (key: string) => key === '--color-accent' ? accent : '12%' }));
  vi.stubGlobal('getComputedStyle', styles);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const animations: Array<{ cancel: ReturnType<typeof vi.fn>; onfinish?: () => void }> = [];
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: vi.fn(() => {
    const result = { cancel: vi.fn() }; animations.push(result); return result;
  }) });
  const node = document.createElement('div');
  const action = accentWash(node);
  try {
    expect(node.children).toHaveLength(1);
    document.documentElement.classList.add('no-accent-transition');
    await Promise.resolve();
    const reads = styles.mock.calls.length;
    accent = '#2288ff';
    document.documentElement.style.setProperty('--test-accent', accent);
    await Promise.resolve();
    expect(styles).toHaveBeenCalledTimes(reads);
    expect(animations).toHaveLength(0);
    document.documentElement.classList.remove('no-accent-transition');
    await Promise.resolve();
    expect(node.children).toHaveLength(2);
    expect(animations).toHaveLength(2);
    animations.at(-1)?.onfinish?.();
    expect(node.children).toHaveLength(1);
    document.documentElement.classList.add('no-gradients');
    await Promise.resolve(); animations.at(-1)?.onfinish?.();
    expect((node.firstElementChild as HTMLElement).style.backgroundImage).toBe('none');
    document.documentElement.classList.remove('no-gradients');
    await Promise.resolve();
    action.update({ enabled: false });
    expect(node.children).toHaveLength(1);
    expect((node.firstElementChild as HTMLElement).style.backgroundImage).toBe('none');
    action.update({ enabled: true });
    animations.at(-1)?.onfinish?.();
    expect((node.firstElementChild as HTMLElement).style.backgroundImage).toContain('34, 136, 255');
  } finally {
    action.destroy();
    document.documentElement.style.removeProperty('--test-accent');
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  }
  expect(node.children).toHaveLength(0);
  expect(node.hasAttribute('data-accent-wash')).toBe(false);
});

it('skips wash animation when reduced motion is enabled', async () => {
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (key: string) => key === '--color-accent' ? '#ff4d5e' : '5%' }));
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const animate = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  const node = document.createElement('div');
  const action = accentWash(node);
  try {
    document.documentElement.classList.add('no-gradients'); await Promise.resolve();
    expect(node.children).toHaveLength(1);
    expect(animate).not.toHaveBeenCalled();
  } finally { action.destroy(); delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate; }
});
