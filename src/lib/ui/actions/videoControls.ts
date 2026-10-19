/** Reveal video chrome on interaction, then fade it after a short idle period. */
export function videoControls(node: HTMLElement, initial: { enabled: boolean }) {
  let enabled = initial.enabled;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let overControls = false;
  let keyboard = false;
  let hidden = false;
  const controls = () => [...node.querySelectorAll<HTMLElement>('[data-video-controls]')];
  function show() {
    hidden = false;
    node.removeAttribute('data-video-idle');
    for (const control of controls()) { control.inert = false; control.removeAttribute('aria-hidden'); }
  }
  function arm() {
    clearTimeout(timer);
    if (!enabled) return;
    timer = setTimeout(() => {
      const focused = keyboard && node.contains(document.activeElement);
      if (overControls || focused || node.querySelector('[aria-expanded="true"]')) return;
      hidden = true;
      node.setAttribute('data-video-idle', '');
      for (const control of controls()) { control.inert = true; control.setAttribute('aria-hidden', 'true'); }
    }, 2400);
  }
  function pointer(event: Event) {
    keyboard = false;
    const target = event.target instanceof Element ? event.target : null;
    overControls = !!target?.closest('[data-video-controls]');
    show(); arm();
  }
  function leave() { overControls = false; arm(); }
  function key() { if (enabled) { keyboard = true; show(); arm(); } }
  function focus() { show(); arm(); }
  const observer = new MutationObserver(() => { if (enabled && !hidden) arm(); });
  observer.observe(node, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'] });
  node.addEventListener('pointermove', pointer);
  node.addEventListener('pointerdown', pointer);
  node.addEventListener('pointerover', pointer);
  node.addEventListener('pointerleave', leave);
  node.addEventListener('focusin', focus);
  node.addEventListener('focusout', focus);
  window.addEventListener('keydown', key, true);
  arm();
  return {
    update(next: { enabled: boolean }) {
      if (enabled === next.enabled) return; // Playback-clock ticks must not reset idle time.
      enabled = next.enabled;
      show(); arm();
    },
    destroy() {
      clearTimeout(timer); observer.disconnect(); show();
      node.removeEventListener('pointermove', pointer);
      node.removeEventListener('pointerdown', pointer);
      node.removeEventListener('pointerover', pointer);
      node.removeEventListener('pointerleave', leave);
      node.removeEventListener('focusin', focus);
      node.removeEventListener('focusout', focus);
      window.removeEventListener('keydown', key, true);
    },
  };
}
