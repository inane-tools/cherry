/** Animate lyric highlight colors while preserving theme-variable updates. */
export function lyricHighlight(node: HTMLElement, active: boolean) {
  let amount = active ? 1 : 0;
  let selected = active;
  let frame = 0;
  const savedColor = node.style.color;
  function paint() {
    node.style.color = `color-mix(in srgb, var(--color-zinc-200) ${(1 - amount) * 100}%, var(--color-accent) ${amount * 100}%)`;
  }
  paint();
  return {
    update(next: boolean) {
      if (next === selected) return;
      selected = next;
      cancelAnimationFrame(frame);
      const start = amount;
      const target = next ? 1 : 0;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { amount = target; paint(); return; }
      const began = performance.now();
      function step(now: number) {
        const t = Math.min(1, Math.max(0, (now - began) / 220));
        amount = start + (target - start) * (1 - (1 - t) ** 3);
        paint();
        frame = t < 1 ? requestAnimationFrame(step) : 0;
      }
      frame = requestAnimationFrame(step);
    },
    destroy() { cancelAnimationFrame(frame); node.style.color = savedColor; },
  };
}
