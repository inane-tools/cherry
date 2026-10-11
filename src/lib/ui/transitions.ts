import { fade, fly as svelteFly } from 'svelte/transition';

export { fade };

/** Linux diagnostic: retain opacity animation without moving composited layers. */
export function fly(node: Element, options: Parameters<typeof svelteFly>[1] = {}) {
  if (document.documentElement.classList.contains('cherry-linux-window')) {
    const { delay, duration, easing } = options ?? {};
    return fade(node, { delay, duration, easing });
  }
  return svelteFly(node, options);
}
