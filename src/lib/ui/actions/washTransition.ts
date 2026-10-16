import { sineInOut } from 'svelte/easing';

/** Fade painted background layers rather than animate inherited colour tokens. */
export function washTransition(node: HTMLElement) {
  const root = document.documentElement;
  let layers: HTMLElement[] = [];
  let animation: Animation | undefined;
  let frame = 0;
  let last = '';
  let destroyed = false;

  function settle() {
    animation?.cancel();
    animation = undefined;
    cancelAnimationFrame(frame);
    frame = 0;
    const newest = layers.at(-1);
    for (const layer of layers) if (layer !== newest) layer.remove();
    layers = newest ? [newest] : [];
    if (newest) newest.style.opacity = '1';
  }

  function update() {
    // The colour picker previews controls while dragging. Keep the painted
    // backdrop stable and avoid a forced style read for every input event.
    if (root.classList.contains('no-accent-transition') && layers.length) return;
    const style = getComputedStyle(node);
    const image = root.classList.contains('no-gradients') ? 'none' : style.getPropertyValue('--cherry-wash-image').trim();
    const color = style.getPropertyValue('--color-surface').trim();
    const key = `${image}:${color}`;
    if (key === last) return;
    last = key;
    settle();
    const layer = document.createElement('div');
    layer.setAttribute('aria-hidden', 'true');
    layer.className = 'cherry-wash-layer';
    layer.style.backgroundImage = image;
    layer.style.backgroundColor = color;
    node.append(layer);
    layers.push(layer);
    const instant = layers.length === 1 || root.classList.contains('no-accent-transition') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (instant) { settle(); return; }
    const finish = () => { if (!destroyed && layers.at(-1) === layer) settle(); };
    // Keep the existing WebKitGTK workaround: opacity changes on the main
    // thread avoid Linux's flickering compositor transitions.
    if (root.classList.contains('cherry-linux-window') || !layer.animate) {
      layer.style.opacity = '0';
      const started = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, Math.max(0, (now - started) / 300));
        layer.style.opacity = String(sineInOut(progress));
        if (progress < 1) frame = requestAnimationFrame(step);
        else finish();
      };
      frame = requestAnimationFrame(step);
    } else {
      animation = layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'cubic-bezier(0.37, 0, 0.63, 1)', fill: 'forwards' });
      animation.onfinish = finish;
    }
  }

  node.setAttribute('data-wash-transition', '');
  update();
  const observer = new MutationObserver(update);
  observer.observe(root, { attributes: true, attributeFilter: ['style', 'class'] });
  return {
    destroy() {
      destroyed = true;
      observer.disconnect();
      animation?.cancel();
      cancelAnimationFrame(frame);
      layers.forEach((layer) => layer.remove());
      node.removeAttribute('data-wash-transition');
    },
  };
}
