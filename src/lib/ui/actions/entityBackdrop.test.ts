import { afterEach, expect, it, vi } from 'vitest';
import { entityBackdrop } from './entityBackdrop';

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

it('extends a banner behind the top bar and scrolls without remeasuring layout', () => {
  const root = document.createElement('div'); root.dataset.pageContent = '';
  const host = document.createElement('div'); host.dataset.pageBackdropHost = '';
  const scroller = document.createElement('main');
  const header = document.createElement('header');
  const banner = document.createElement('div');
  const cover = document.createElement('div'); cover.dataset.entityCover = '';
  header.append(banner, cover); scroller.append(header); root.append(host, scroller); document.body.append(root);
  const coverRect = vi.spyOn(cover, 'getBoundingClientRect').mockReturnValue({ top: 112 } as DOMRect);
  Object.defineProperty(cover, 'offsetHeight', { value: 176 });
  const headerRect = vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({ top: 72 } as DOMRect);
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect);
  Object.defineProperty(header, 'offsetHeight', { value: 288, configurable: true });
  const disconnect = vi.fn();
  let resize = () => {};
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {} disconnect() { disconnect(); }
  });
  const action = entityBackdrop(banner)!;
  expect(banner.parentElement).toBe(host);
  expect(banner.style.height).toBe('360px');
  expect(banner.style.top).toBe('0px');
  expect(banner.style.getPropertyValue('--entity-fade-start')).toBe('112px');
  expect(banner.style.getPropertyValue('--entity-fade-end')).toBe('288px');
  scroller.scrollTop = 100; scroller.dispatchEvent(new Event('scroll'));
  expect(banner.style.transform).toBe('translateY(-100px)');
  expect(headerRect).toHaveBeenCalledTimes(1);
  expect(coverRect).toHaveBeenCalledTimes(1);
  headerRect.mockReturnValue({ top: -28 } as DOMRect);
  coverRect.mockReturnValue({ top: 12 } as DOMRect); resize();
  expect(banner.style.getPropertyValue('--entity-fade-start')).toBe('112px');
  expect(banner.style.getPropertyValue('--entity-fade-end')).toBe('288px');
  expect(banner.style.height).toBe('360px');
  Object.defineProperty(header, 'offsetHeight', { value: 420 });
  resize();
  expect(banner.style.height).toBe('492px');
  expect(banner.style.getPropertyValue('--entity-fade-end')).toBe('288px');
  action.destroy();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(host.children).toHaveLength(0);
  scroller.scrollTop = 200; scroller.dispatchEvent(new Event('scroll'));
  expect(banner.style.transform).toBe('translateY(-100px)');
});

it('retains the inline banner when no app backdrop host is present', () => {
  const header = document.createElement('header'), banner = document.createElement('div');
  header.append(banner); document.body.append(header);
  expect(entityBackdrop(banner)).toBeUndefined();
  expect(banner.parentElement).toBe(header);
});
