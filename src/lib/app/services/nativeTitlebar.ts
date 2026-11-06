import { writable } from 'svelte/store';
import { isDesktop, isMacDesktop, isLinuxDesktop } from './platform';

type Overlay = EventTarget & {
  visible: boolean;
  getTitlebarAreaRect(): DOMRect;
};

export const nativeTitlebar = writable({ left: 0, right: 0 });

/** Measure where the content bar actually starts, including live sidebar resize. */
export function trackTitlebarOffset(node: HTMLElement) {
  if (!isMacDesktop() && !isLinuxDesktop()) return { destroy() {} };
  const update = () => {
    node.style.setProperty('--titlebar-window-offset', `${node.getBoundingClientRect().left}px`);
  };
  const observer = new ResizeObserver(update);
  observer.observe(node);
  if (node.parentElement) observer.observe(node.parentElement);
  window.addEventListener('resize', update);
  const stop = nativeTitlebar.subscribe(update);
  update();
  return { destroy() {
    stop();
    observer.disconnect();
    window.removeEventListener('resize', update);
  } };
}

/** The overlay reports usable CSS coordinates, including system layout and zoom. */
export function titlebarInsets(rect: Pick<DOMRect, 'x' | 'width' | 'height'>, width: number) {
  if (rect.height <= 0 || rect.width <= 0) return { left: 0, right: 0 };
  const left = Math.max(0, Math.min(width, rect.x));
  return { left, right: Math.max(0, width - left - rect.width) };
}

export function trackNativeTitlebar(): () => void {
  // macOS uses its existing fixed traffic-light inset, Windows renderer captions.
  if (!isDesktop() || isMacDesktop() || !/Linux/.test(navigator.userAgent)) return () => {};
  const overlay = (navigator as Navigator & { windowControlsOverlay?: Overlay }).windowControlsOverlay;
  if (!overlay) return () => {};
  const update = () => nativeTitlebar.set(overlay.visible
    ? titlebarInsets(overlay.getTitlebarAreaRect(), window.innerWidth)
    : { left: 0, right: 0 });
  overlay.addEventListener('geometrychange', update);
  window.addEventListener('resize', update);
  update();
  return () => {
    overlay.removeEventListener('geometrychange', update);
    window.removeEventListener('resize', update);
  };
}
