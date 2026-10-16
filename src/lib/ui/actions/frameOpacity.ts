import { sineInOut } from 'svelte/easing';

interface Options {
  visible: boolean;
  duration: number;
}

/** Keep CSS fades on other platforms; avoid compositor-driven fades on Linux. */
export function frameOpacity(node: HTMLElement, initial: Options) {
  if (!document.documentElement.classList.contains('cherry-linux-window')) {
    const timing = node.style.transitionTimingFunction;
    node.style.transitionTimingFunction = 'cubic-bezier(0.37, 0, 0.63, 1)';
    return { destroy() { node.style.transitionTimingFunction = timing; } };
  }

  const savedOpacity = node.style.opacity;
  const savedTransition = node.style.transitionProperty;
  node.style.transitionProperty = 'none';
  let value = initial.visible ? 1 : 0;
  let target = value;
  let frame = 0;
  node.style.opacity = String(value);

  return {
    update({ visible, duration }: Options) {
      const next = visible ? 1 : 0;
      if (next === target) return;
      target = next;
      cancelAnimationFrame(frame);
      const start = value;
      const started = performance.now();
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || duration <= 0) {
        value = target;
        node.style.opacity = String(value);
        return;
      }
      const step = (now: number) => {
        const progress = Math.min(1, Math.max(0, (now - started) / duration));
        value = start + (target - start) * sineInOut(progress);
        node.style.opacity = String(value);
        frame = progress < 1 ? requestAnimationFrame(step) : 0;
      };
      frame = requestAnimationFrame(step);
    },
    destroy() {
      cancelAnimationFrame(frame);
      node.style.opacity = savedOpacity;
      node.style.transitionProperty = savedTransition;
    },
  };
}
