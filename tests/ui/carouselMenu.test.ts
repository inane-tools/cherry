import { afterEach, expect, it, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import Carousel from '../../src/lib/ui/components/Carousel.svelte';
import type { CarouselEntry } from '../../src/lib/ui/components/carouselTypes';

afterEach(() => vi.unstubAllGlobals());

it.each(['cards', 'songs', 'buttons'] as const)('opens context menus in the %s layout without triggering selection', async layout => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const target = document.createElement('div'); document.body.appendChild(target);
  const entry: CarouselEntry = { key: 'c:VLplaylist', browseId: 'VLplaylist', title: 'Playlist', thumbnails: [], kind: 'card' };
  const select = vi.fn(), play = vi.fn(), context = vi.fn();
  const component = mount(Carousel, { target, props: { entries: [entry], layout, onSelect: select, onPlay: play, onContextMenu: context } });
  try {
    await tick();
    const button = layout === 'buttons' ? target.querySelector<HTMLButtonElement>('.snap-start')!
      : target.querySelector<HTMLButtonElement>('[aria-label="Open Playlist"]')!;
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(context).toHaveBeenCalledExactlyOnceWith(event, entry);
    expect(select).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    button.click();
    expect(select).toHaveBeenCalledExactlyOnceWith(entry);
  } finally { await unmount(component); target.remove(); }
});

it.each(['grid', 'list'] as const)('keeps open, play and context actions in %s collection pages without horizontal controls', async presentation => {
  const target = document.createElement('div'); document.body.append(target);
  const entry: CarouselEntry = { key: 'c:VLplaylist', browseId: 'VLplaylist', title: 'Playlist', thumbnails: [], kind: 'card' };
  const select = vi.fn(), play = vi.fn(), context = vi.fn();
  const component = mount(Carousel, { target, props: { presentation, entries: [entry], onSelect: select, onPlay: play, onContextMenu: context } });
  try {
    await tick();
    expect(target.querySelector('[aria-label="Scroll left"]')).toBeNull();
    expect(target.querySelector('.cherry-overlay-scroll-x')).toBeNull();
    target.querySelector<HTMLButtonElement>('[aria-label="Open Playlist"]')!.click();
    expect(select).toHaveBeenCalledExactlyOnceWith(entry);
    target.querySelector<HTMLButtonElement>('[aria-label="Play Playlist"]')!.click();
    expect(play).toHaveBeenCalledExactlyOnceWith(entry);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    target.querySelector('[aria-label="Open Playlist"]')!.dispatchEvent(event);
    expect(context).toHaveBeenCalledExactlyOnceWith(event, entry);
  } finally { await unmount(component); target.remove(); }
});

it('keeps carousel paging on the arrows with no scrollbar or manual scroll viewport', async () => {
  let resize = () => {};
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
  const target = document.createElement('div'); document.body.append(target);
  const entries: CarouselEntry[] = Array.from({ length: 8 }, (_, index) => ({ key: `s:${index}`, title: `Song ${index}`, kind: 'song', thumbnails: [] }));
  const component = mount(Carousel, { target, props: { entries, onSelect: vi.fn(), onPlay: vi.fn() } });
  try {
    await tick();
    const viewport = target.querySelector<HTMLElement>('.cherry-carousel')!;
    Object.defineProperty(viewport, 'clientWidth', { value: 400 });
    Object.defineProperty(viewport, 'scrollWidth', { value: 1000 });
    Object.defineProperty(viewport.firstElementChild, 'offsetWidth', { value: 160 });
    viewport.scrollBy = vi.fn();
    resize(); await tick();
    expect(viewport.classList.contains('overflow-x-hidden')).toBe(true);
    expect(target.querySelector('.cherry-sb-track')).toBeNull();
    target.querySelector<HTMLButtonElement>('[aria-label="Scroll right"]')!.click();
    expect(viewport.scrollBy).toHaveBeenCalledWith({ left: 344, behavior: 'auto' });
    viewport.scrollLeft = 600; viewport.dispatchEvent(new Event('scroll')); await tick();
    expect(target.querySelector<HTMLButtonElement>('[aria-label="Scroll right"]')!.disabled).toBe(true);
    target.querySelector<HTMLButtonElement>('[aria-label="Scroll left"]')!.click();
    expect(viewport.scrollBy).toHaveBeenLastCalledWith({ left: -344, behavior: 'auto' });
  } finally { await unmount(component); target.remove(); }
});
