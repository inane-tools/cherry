// A thin, overlay scrollbar drawn by the app.
//
// WebView2/Edge renders native scrollbars and ignores all `::-webkit-scrollbar`
// styling, which is why the app previously used the `OverlayScrollbar` browser
// flag — but that flag stops *secondary* webviews (the YouTube Music login
// window) from initialising, so it can't be used. Instead the native bar is
// hidden with the standard `scrollbar-width: none` (which WebView2 does honour
// when set on the scroll container itself) and this action paints a slim thumb
// over the content.
//
// The thumb is an absolutely-positioned child of the scroller, so it scrolls
// with the content. On scroll we therefore position it purely with `transform`
// (never `top`), which avoids a per-frame layout read/reflow and — because it is
// written synchronously in the scroll handler, not deferred to an animation
// frame — never lags a frame behind the content (the old source of "jitter" on
// long playlists).

const MIN_THUMB = 28;
const HIDE_AFTER_MS = 800;
/**
 * Content can stream in (playlist pages, home feed) which changes `scrollHeight`
 * many times a second. Measuring on every mutation forces a layout read + write
 * each frame and makes the thumb jump around, so growth is coalesced instead.
 */
const MEASURE_DEBOUNCE_MS = 120;

export interface OverlayScrollbarOptions {
  /** Hide the thumb entirely (e.g. the compact sidebar). */
  enabled?: boolean;
  /**
   * Pixels at the top of the scroller the thumb must stay below. Used when the
   * scroller runs under an overlaid title bar, so the bar does not sit behind it.
   */
  topInset?: number;
}

export function overlayScrollbar(node: HTMLElement, options: OverlayScrollbarOptions = {}) {
  const thumb = document.createElement('div');
  thumb.className = 'cherry-sb-thumb';
  node.appendChild(thumb);

  let enabled = options.enabled !== false;
  let topInset = Math.max(0, options.topInset ?? 0);

  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let measureTimer: ReturnType<typeof setTimeout> | null = null;
  let frame = 0;

  // Cached geometry; refreshed on resize/mutation only (not on scroll).
  let hasThumb = false;
  let travel = 0; // thumb travel per pixel scrolled: (available - h) / (content - viewport)
  let lastContent = -1;
  let lastViewport = -1;

  function measure(): void {
    if (!enabled) {
      hasThumb = false;
      thumb.style.display = 'none';
      return;
    }
    const viewport = node.clientHeight;
    const content = node.scrollHeight;
    if (content === lastContent && viewport === lastViewport) return;
    lastContent = content;
    lastViewport = viewport;
    if (content <= viewport + 1) {
      hasThumb = false;
      thumb.style.display = 'none';
      return;
    }
    hasThumb = true;
    thumb.style.display = '';
    // The track is only as long as the visible content area (below the inset).
    const available = Math.max(0, viewport - topInset);
    const height = Math.max(MIN_THUMB, Math.round((available * viewport) / content));
    travel = content - viewport > 0 ? (available - height) / (content - viewport) : 0;
    thumb.style.height = `${height}px`;
  }

  function paint(): void {
    if (!hasThumb) return;
    // The thumb scrolls with the content, so add the scroll offset back before
    // applying the proportional travel, then offset below the inset:
    // visual y = topInset + scrollTop * travel.
    thumb.style.transform = `translateY(${topInset + node.scrollTop * (1 + travel)}px)`;
  }

  function scheduleMeasure(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      measure();
      paint();
    });
  }

  function scheduleMeasureDebounced(): void {
    if (measureTimer) clearTimeout(measureTimer);
    measureTimer = setTimeout(() => {
      measureTimer = null;
      scheduleMeasure();
    }, MEASURE_DEBOUNCE_MS);
  }

  function setVisible(value: boolean): void {
    thumb.classList.toggle('is-visible', value);
  }

  function reveal(): void {
    if (!enabled) return;
    setVisible(true);
    paint();
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
  }

  function onEnter(): void {
    if (!enabled) return;
    setVisible(true);
    if (hideTimer) clearTimeout(hideTimer);
    paint();
  }

  function onLeave(): void {
    setVisible(false);
  }

  // No layout read here — just `scrollTop` and a transform write — so this can
  // run synchronously on every scroll without reflowing or lagging.
  node.addEventListener('scroll', reveal, { passive: true });
  node.addEventListener('mouseenter', onEnter);
  node.addEventListener('mouseleave', onLeave);

  const resize = new ResizeObserver(() => scheduleMeasure());
  resize.observe(node);
  const mutate = new MutationObserver(() => scheduleMeasureDebounced());
  mutate.observe(node, { childList: true, subtree: true });

  measure();
  paint();

  return {
    update(next: OverlayScrollbarOptions = {}): void {
      const nextEnabled = next.enabled !== false;
      const nextInset = Math.max(0, next.topInset ?? 0);
      if (nextEnabled === enabled && nextInset === topInset) return;
      enabled = nextEnabled;
      topInset = nextInset;
      lastContent = -1;
      lastViewport = -1;
      if (!enabled) setVisible(false);
      scheduleMeasure();
    },
    destroy() {
      node.removeEventListener('scroll', reveal);
      node.removeEventListener('mouseenter', onEnter);
      node.removeEventListener('mouseleave', onLeave);
      resize.disconnect();
      mutate.disconnect();
      if (hideTimer) clearTimeout(hideTimer);
      if (measureTimer) clearTimeout(measureTimer);
      if (frame) cancelAnimationFrame(frame);
      thumb.remove();
    },
  };
}
