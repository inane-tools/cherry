import { fade as svelteFade, fly as svelteFly } from 'svelte/transition';

function isLinuxWindow() {
  return document.documentElement.classList.contains('cherry-linux-window');
}

/** Linux diagnostic: bypass opacity animation as well as layer movement. */
export function fade(node: Element, options: Parameters<typeof svelteFade>[1] = {}) {
  return svelteFade(node, isLinuxWindow() ? { ...options, delay: 0, duration: 0 } : options);
}

/** Keep native Windows/macOS transitions while testing instant Linux popups. */
export function fly(node: Element, options: Parameters<typeof svelteFly>[1] = {}) {
  if (isLinuxWindow()) {
    return svelteFade(node, { delay: 0, duration: 0 });
  }
  return svelteFly(node, options);
}
