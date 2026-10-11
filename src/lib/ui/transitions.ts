import { fade as nativeFade, fly as nativeFly } from 'svelte/transition';
import type { TransitionConfig } from 'svelte/transition';

/** Linux diagnostic: animate styles on the main thread instead of keyframes. */
function frameDriven(node: Element, config: TransitionConfig): TransitionConfig {
  if (!document.documentElement.classList.contains('cherry-linux-window') || !config.css) {
    return config;
  }
  const element = node as HTMLElement;
  const { css, tick, ...timing } = config;
  const scratch = document.createElement('div').style;
  const original = new Map<string, { value: string; priority: string }>();
  return {
    ...timing,
    tick(t, u) {
      scratch.cssText = css(t, u);
      for (let i = 0; i < scratch.length; i++) {
        const property = scratch[i];
        if (!original.has(property)) {
          original.set(property, {
            value: element.style.getPropertyValue(property),
            priority: element.style.getPropertyPriority(property),
          });
        }
        element.style.setProperty(property, scratch.getPropertyValue(property));
      }
      // Svelte also calls tick(1, 0) when an outro is cancelled. Restore the
      // prior inline values without disturbing unrelated styles or classes.
      if (t === 1) {
        for (const [property, previous] of original) {
          if (previous.value) element.style.setProperty(property, previous.value, previous.priority);
          else element.style.removeProperty(property);
        }
      }
      tick?.(t, u);
    },
  };
}

export function fade(node: Element, options: Parameters<typeof nativeFade>[1] = {}) {
  return frameDriven(node, nativeFade(node, options));
}

export function fly(node: Element, options: Parameters<typeof nativeFly>[1] = {}) {
  return frameDriven(node, nativeFly(node, options));
}
