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
// long playlists). Geometry is measured only when it can actually change.

const MIN_THUMB = 28;
const HIDE_AFTER_MS = 800;

export function overlayScrollbar(node: HTMLElement) {
  const thumb = document.createElement('div');
  thumb.className = 'cherry-sb-thumb';
  node.appendChild(thumb);

  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let frame = 0;

  // Cached geometry; refreshed on resize/mutation only (not on scroll).
  let hasThumb = false;
  let travel = 0; // thumb travel per pixel scrolled: (viewport - h) / (content - viewport)

  function measure(): void {
    const viewport = node.clientHeight;
    const content = node.scrollHeight;
    if (content <= viewport + 1) {
      hasThumb = false;
      thumb.style.display = 'none';
      return;
    }
    hasThumb = true;
    thumb.style.display = '';
    const height = Math.max(MIN_THUMB, Math.round((viewport * viewport) / content));
    travel = (viewport - height) / (content - viewport);
    thumb.style.height = `${height}px`;
  }

  function paint(): void {
    if (!hasThumb) return;
    // The thumb scrolls with the content, so add the scroll offset back before
    // applying the proportional travel: visual y = scrollTop * travel.
    thumb.style.transform = `translateY(${node.scrollTop * (1 + travel)}px)`;
  }

  function scheduleMeasure(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      measure();
      paint();
    });
  }

  function setVisible(value: boolean): void {
    thumb.classList.toggle('is-visible', value);
  }

  function reveal(): void {
    setVisible(true);
    paint();
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
  }

  function onEnter(): void {
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
  const mutate = new MutationObserver(() => scheduleMeasure());
  mutate.observe(node, { childList: true, subtree: true });

  measure();
  paint();

  return {
    destroy() {
      node.removeEventListener('scroll', reveal);
      node.removeEventListener('mouseenter', onEnter);
      node.removeEventListener('mouseleave', onLeave);
      resize.disconnect();
      mutate.disconnect();
      if (hideTimer) clearTimeout(hideTimer);
      if (frame) cancelAnimationFrame(frame);
      thumb.remove();
    },
  };
}
