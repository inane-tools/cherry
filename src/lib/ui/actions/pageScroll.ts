import { tick } from 'svelte';
import { get } from 'svelte/store';
import { pageStore, pageKey } from '$lib/app/services/navigation';
import { pageVisitStore, pageVisitCacheEpoch, readPagePosition, savePagePosition } from '$lib/app/services/pageVisit';

/** Restore feed positions on history navigation, without retaining hidden views. */
export function pageScroll(node: HTMLElement) {
  let current: { key: string; token: object; feed: boolean } | undefined;
  let revision = 0;
  let cleanup = () => {};
  const cancel = () => { revision++; cleanup(); cleanup = () => {}; };
  function save() {
    if (!current?.feed) return;
    const horizontal: Record<string, number> = {};
    for (const item of node.querySelectorAll<HTMLElement>('[data-page-scroll-key]')) {
      horizontal[item.dataset.pageScrollKey!] = item.scrollLeft;
    }
    savePagePosition(current.token, { top: node.scrollTop, horizontal });
  }
  const stopEpoch = pageVisitCacheEpoch.subscribe(() => { cancel(); node.scrollTop = 0; });
  const stopPage = pageStore.subscribe(page => {
    const visit = get(pageVisitStore);
    const key = `${page.view}:${pageKey(page)}`;
    if (current?.key === key && current.token === visit.token) return;
    save(); cancel();
    current = { key, token: visit.token, feed: page.view === 'home' || page.view === 'explore' };
    const position = current.feed && visit.restore ? readPagePosition(visit.token) : undefined;
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll'));
    if (!position) return;
    const version = revision;
    void tick().then(() => {
      if (version !== revision) return;
      let frame = 0;
      const restore = () => {
        frame = 0;
        if (version !== revision) return;
        node.scrollTop = position.top;
        for (const item of node.querySelectorAll<HTMLElement>('[data-page-scroll-key]')) {
          const left = position.horizontal[item.dataset.pageScrollKey!];
          if (left !== undefined) item.scrollLeft = left;
        }
        // Scroll listeners also update the title bar and the carousel arrows.
        node.dispatchEvent(new Event('scroll'));
        for (const item of node.querySelectorAll<HTMLElement>('[data-page-scroll-key]')) item.dispatchEvent(new Event('scroll'));
      };
      const schedule = () => { if (version === revision && !frame) frame = requestAnimationFrame(restore); };
      const resize = new ResizeObserver(schedule);
      const watchContent = () => { resize.disconnect(); if (node.firstElementChild) resize.observe(node.firstElementChild); schedule(); };
      const mutate = new MutationObserver(watchContent);
      mutate.observe(node, { childList: true, subtree: true });
      watchContent();
      const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
      // The custom scrollbar is a sibling of the viewport. Capture here also
      // catches its input before the thumb's handlers stop propagation.
      const inputHost = node.parentElement ?? node;
      for (const type of inputs) inputHost.addEventListener(type, cancel, { passive: true, capture: true });
      const timer = setTimeout(cancel, 1500);
      cleanup = () => {
        if (frame) cancelAnimationFrame(frame);
        clearTimeout(timer); resize.disconnect(); mutate.disconnect();
        for (const type of inputs) inputHost.removeEventListener(type, cancel, true);
      };
      restore();
    });
  });
  return { destroy() { save(); cancel(); stopPage(); stopEpoch(); } };
}
