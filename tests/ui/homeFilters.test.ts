import { afterEach, expect, it, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import HomeFilters from '../../src/lib/ui/components/HomeFilters.svelte';

afterEach(() => vi.unstubAllGlobals());

it('scrolls overflowing filters, updates edge controls, and retains filter selection', async () => {
  const observers: (() => void)[] = [];
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { observers.push(callback); }
    observe() {} unobserve() {} disconnect() { disconnect(); }
  });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const podcasts = { label: 'Podcasts', browseId: 'FEmusic_home', params: 'podcasts' };
  const select = vi.fn();
  const target = document.createElement('div'); document.body.appendChild(target);
  const component = mount(HomeFilters, { target, props: { filters: [podcasts], value: podcasts, onSelect: select } });
  try {
    await tick();
    const root = target.firstElementChild!;
    const scroller = target.querySelector<HTMLDivElement>('[aria-label="Home filters"]')!;
    const content = scroller.firstElementChild!;
    expect(scroller.classList.contains('overflow-x-hidden')).toBe(true);
    expect(target.querySelector('.cherry-sb-track')).toBeNull();
    let viewport = 220, available = 300;
    Object.defineProperty(root, 'clientWidth', { get: () => available });
    Object.defineProperty(scroller, 'clientWidth', { get: () => viewport });
    Object.defineProperty(scroller, 'scrollWidth', { value: 700 });
    Object.defineProperty(content, 'scrollWidth', { value: 700 });
    const scrollBy = vi.fn(); scroller.scrollBy = scrollBy;
    observers.forEach(callback => callback()); await tick();
    const left = target.querySelector<HTMLButtonElement>('[aria-label="Scroll filters left"]')!;
    const right = target.querySelector<HTMLButtonElement>('[aria-label="Scroll filters right"]')!;
    expect(left.disabled).toBe(true); expect(right.disabled).toBe(false);
    expect(scroller.style.maskImage).toMatch(/transparent\)$/);
    right.click(); expect(scrollBy).toHaveBeenLastCalledWith({ left: 176, behavior: 'smooth' });
    scroller.scrollLeft = 480; scroller.dispatchEvent(new Event('scroll')); await tick();
    expect(right.disabled).toBe(true); expect(left.disabled).toBe(false);
    expect(scroller.style.maskImage).toContain('to right, transparent');
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    left.click(); expect(scrollBy).toHaveBeenLastCalledWith({ left: -176, behavior: 'auto' });
    const buttons = Array.from(content.querySelectorAll('button'));
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
    buttons[1].click(); expect(select).toHaveBeenLastCalledWith(podcasts);
    buttons[0].click(); expect(select).toHaveBeenLastCalledWith(null);
    available = viewport = 900; scroller.scrollLeft = 0;
    observers.forEach(callback => callback()); await tick();
    expect(target.querySelector('[aria-label="Scroll filters right"]')).toBeNull();
    expect(scroller.style.maskImage).not.toContain('transparent');
  } finally { await unmount(component); target.remove(); }
  expect(disconnect).toHaveBeenCalledTimes(3);
});
