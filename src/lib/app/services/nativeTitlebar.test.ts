import { afterEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { nativeTitlebar, titlebarInsets, trackNativeTitlebar, trackTitlebarOffset } from './nativeTitlebar';

afterEach(() => { delete window.cherryDesktop; vi.unstubAllGlobals(); nativeTitlebar.set({ left: 0, right: 0 }); });

it('reserves either or both system button groups using CSS coordinates', () => {
  expect(titlebarInsets({ x: 90, width: 910, height: 48 }, 1000)).toEqual({ left: 90, right: 0 });
  expect(titlebarInsets({ x: 0, width: 880, height: 48 }, 1000)).toEqual({ left: 0, right: 120 });
  expect(titlebarInsets({ x: 40, width: 900, height: 48 }, 1000)).toEqual({ left: 40, right: 60 });
  expect(titlebarInsets({ x: 0, width: 0, height: 0 }, 1000)).toEqual({ left: 0, right: 0 });
});

it('uses the actual content origin after sidebar resizing, hiding controls and zoom', () => {
  vi.stubGlobal('navigator', { userAgent: 'Linux' });
  Object.defineProperty(window, 'cherryDesktop', { configurable: true, value: { platform: 'linux' } });
  let resize = () => {};
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  const header = document.createElement('header');
  let offset = 56;
  header.getBoundingClientRect = () => ({ left: offset }) as DOMRect;
  const action = trackTitlebarOffset(header);
  expect(header.style.getPropertyValue('--titlebar-window-offset')).toBe('56px');
  offset = 176;
  resize();
  expect(header.style.getPropertyValue('--titlebar-window-offset')).toBe('176px');
  offset = 0;
  nativeTitlebar.set({ left: 180, right: 0 });
  expect(header.style.getPropertyValue('--titlebar-window-offset')).toBe('0px');
  action.destroy();
});

it('tracks native layout changes, resize and fullscreen, and removes listeners', () => {
  const overlay = Object.assign(new EventTarget(), {
    visible: true,
    getTitlebarAreaRect: () => ({ x: 90, width: 910, height: 48 }),
  });
  const window = Object.assign(new EventTarget(), { cherryDesktop: {}, innerWidth: 1000 });
  vi.stubGlobal('window', window);
  vi.stubGlobal('navigator', { userAgent: 'Linux', windowControlsOverlay: overlay });
  const stop = trackNativeTitlebar();
  expect(get(nativeTitlebar)).toEqual({ left: 90, right: 0 });
  overlay.getTitlebarAreaRect = () => ({ x: 0, width: 880, height: 48 });
  overlay.dispatchEvent(new Event('geometrychange'));
  expect(get(nativeTitlebar)).toEqual({ left: 0, right: 120 });
  window.innerWidth = 1100;
  window.dispatchEvent(new Event('resize'));
  expect(get(nativeTitlebar).right).toBe(220);
  overlay.visible = false;
  overlay.dispatchEvent(new Event('geometrychange'));
  expect(get(nativeTitlebar)).toEqual({ left: 0, right: 0 });
  stop();
  overlay.visible = true;
  overlay.dispatchEvent(new Event('geometrychange'));
  expect(get(nativeTitlebar)).toEqual({ left: 0, right: 0 });
});
