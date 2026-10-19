import { fade as nativeFade, fly as nativeFly, slide as nativeSlide } from 'svelte/transition';
import { flip as nativeFlip } from 'svelte/animate';
import { cubicOut, sineInOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

/** Keep Chromium's native transitions while respecting reduced motion. */
function respectMotion(config: TransitionConfig): TransitionConfig {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ? { ...config, delay: 0, duration: 0 }
    : config;
}

export function fade(node: Element, options: Parameters<typeof nativeFade>[1] = {}) {
  return respectMotion(nativeFade(node, { duration: 160, easing: sineInOut, ...options }));
}

export function fly(node: Element, options: Parameters<typeof nativeFly>[1] = {}) {
  return respectMotion(nativeFly(node, { duration: 220, easing: cubicOut, ...options }));
}

/** A small expansion from the cursor/trigger edge, shared by floating menus. */
export function menuReveal(node: Element, { duration = 170, distance = 4, scale = 0.98 } = {}) {
  const style = getComputedStyle(node);
  const transform = style.transform === 'none' ? '' : style.transform;
  const opacity = Number(style.opacity) || 1;
  return respectMotion({ duration, easing: cubicOut, css: (t: number) => `
    transform-origin: var(--menu-origin, 50% 0%);
    transform: ${transform} translateY(calc(${(1 - t) * distance}px * var(--menu-direction, 1))) scale(${scale + (1 - scale) * t});
    opacity: ${opacity * t};
  ` });
}

export function slide(node: Element, options: Parameters<typeof nativeSlide>[1] = {}) {
  return respectMotion(nativeSlide(node, { duration: 200, easing: cubicOut, ...options }));
}

export function flip(node: Element, rects: Parameters<typeof nativeFlip>[1], options: Parameters<typeof nativeFlip>[2] = {}) {
  return respectMotion(nativeFlip(node, rects, { duration: 220, easing: cubicOut, ...options }));
}
