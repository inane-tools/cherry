/** Fixed-height list window. A focused/dragged row can stay mounted outside it. */
export function rowWindow(count: number, scroll: number, height: number, rowHeight: number, overscan = 6): { start: number; end: number } {
  const first = Math.max(0, Math.floor(scroll / rowHeight));
  const start = Math.min(Math.max(0, count - 1), Math.max(0, first - overscan));
  return { start, end: Math.min(count, Math.max(start + 1, Math.ceil((Math.max(0, scroll) + Math.max(height, rowHeight)) / rowHeight) + overscan)) };
}
export function rowIndexes(count: number, start: number, end: number, pinned = -1): number[] {
  const indexes = Array.from({ length: Math.max(0, Math.min(count, end) - start) }, (_, i) => start + i);
  if (pinned >= 0 && pinned < count && !indexes.includes(pinned)) indexes.push(pinned);
  return indexes.sort((a, b) => a - b);
}
interface Options { count: number; rowHeight: number; onRange: (start: number, end: number) => void }
export function virtualRows(node: HTMLElement, initial: Options) {
  let options = initial;
  let frame = 0;
  let parent = node.parentElement;
  while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
  const viewport = parent ?? node.parentElement!;
  function measure() {
    frame = 0;
    const offset = node.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop - viewport.clientTop;
    const range = rowWindow(options.count, viewport.scrollTop - offset, viewport.clientHeight || 400, options.rowHeight);
    options.onRange(range.start, range.end);
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
  viewport.addEventListener('scroll', schedule, { passive: true });
  const observer = new ResizeObserver(schedule);
  observer.observe(viewport);
  // Collection headers above the list can change height after loading. Observe
  // their shared content host so the window follows its new document offset.
  if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
  measure();
  return {
    update(next: Options) { options = next; schedule(); },
    destroy() { if (frame) cancelAnimationFrame(frame); observer.disconnect(); viewport.removeEventListener('scroll', schedule); },
  };
}
