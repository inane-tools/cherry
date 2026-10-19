/** Crossfade painted washes once per committed accent change. */
export function accentWash(node: HTMLElement, options: { enabled?: boolean } = {}) {
  const root = document.documentElement;
  let enabled = options.enabled !== false;
  let last = '';
  let layers: HTMLElement[] = [];
  let animations: Animation[] = [];
  let destroyed = false;

  function settle() {
    for (const animation of animations) animation.cancel();
    animations = [];
    const newest = layers.at(-1);
    for (const layer of layers) if (layer !== newest) layer.remove();
    layers = newest ? [newest] : [];
    if (newest) newest.style.opacity = '1';
  }
  function paint() {
    // The accent slider previews controls while dragging; paint the wash once
    // the colour is committed, instead of rereading styles on every input.
    if (enabled && root.classList.contains('no-accent-transition') && layers.length) return;
    const style = getComputedStyle(node);
    // Read the target value, not a root transition's in-flight colour; the wash
    // has its own compositor crossfade and should not lag a change behind.
    const accent = root.style.getPropertyValue('--color-accent').trim() || style.getPropertyValue('--color-accent').trim();
    const strength = style.getPropertyValue('--shell-wash-strength').trim() || '12%';
    const image = enabled && !root.classList.contains('no-gradients')
      ? `linear-gradient(to bottom, color-mix(in srgb, ${accent} ${strength}, transparent), transparent)` : 'none';
    if (image === last) return;
    last = image;
    settle();
    const previous = layers.at(-1);
    const layer = document.createElement('div');
    layer.className = 'cherry-shell-wash';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.backgroundImage = image;
    node.appendChild(layer);
    layers.push(layer);
    // Banner pages must never keep an outgoing accent wash behind their art.
    if (!enabled || !previous || !layer.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      settle(); return;
    }
    const timing = { duration: 240, easing: 'cubic-bezier(0.37, 0, 0.63, 1)', fill: 'forwards' as const };
    animations = [previous.animate([{ opacity: 1 }, { opacity: 0 }], timing), layer.animate([{ opacity: 0 }, { opacity: 1 }], timing)];
    animations[1].onfinish = () => { if (!destroyed && layers.at(-1) === layer) settle(); };
  }

  node.setAttribute('data-accent-wash', '');
  paint();
  const observer = new MutationObserver(paint);
  observer.observe(root, { attributes: true, attributeFilter: ['style', 'class'] });
  return {
    update(next: { enabled?: boolean } = {}) {
      if (enabled === (next.enabled !== false)) return;
      enabled = next.enabled !== false;
      paint();
    },
    destroy() {
      destroyed = true;
      observer.disconnect();
      for (const animation of animations) animation.cancel();
      for (const layer of layers) layer.remove();
      node.removeAttribute('data-accent-wash');
    },
  };
}
