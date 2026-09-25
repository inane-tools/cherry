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
// with the content; `top` is offset by `scrollTop` to keep it anchored to the
// scrollport. Its extent never exceeds the content, so it adds no overflow.

const MIN_THUMB = 28;
const HIDE_AFTER_MS = 800;

export function overlayScrollbar(node: HTMLElement) {
  const thumb = document.createElement('div');
  thumb.className = 'cherry-sb-thumb';
  node.appendChild(thumb);

  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let visible = false;
  // Coalesce to one layout read/write per animation frame: `scroll` fires far
  // faster than the display refreshes, and each `update()` forces a reflow.
  let frame = 0;

  function schedule(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  }

  function measure(): { h: number; top: number } | null {
    const viewport = node.clientHeight;
    const content = node.scrollHeight;
    const scroll = node.scrollTop;
    if (content <= viewport + 1) return null;
    const h = Math.max(MIN_THUMB, Math.round((viewport * viewport) / content));
    const top = (viewport - h) * (scroll / (content - viewport));
    return { h, top };
  }

  function update(): void {
    const size = measure();
    if (!size) {
      thumb.style.opacity = '0';
      thumb.style.height = '0px';
      return;
    }
    thumb.style.height = `${size.h}px`;
    // Content scrolls up by scrollTop, so add it back to stay in place.
    thumb.style.top = `${size.top + node.scrollTop}px`;
    thumb.classList.toggle('is-visible', visible);
    thumb.style.opacity = '';
  }

  function reveal(): void {
    visible = true;
    schedule();
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      visible = false;
      schedule();
    }, HIDE_AFTER_MS);
  }

  function onEnter(): void {
    visible = true;
    if (hideTimer) clearTimeout(hideTimer);
    schedule();
  }

  function onLeave(): void {
    visible = false;
    schedule();
  }

  node.addEventListener('scroll', reveal, { passive: true });
  node.addEventListener('mouseenter', onEnter);
  node.addEventListener('mouseleave', onLeave);

  const resize = new ResizeObserver(() => schedule());
  resize.observe(node);
  const mutate = new MutationObserver(() => schedule());
  mutate.observe(node, { childList: true, subtree: true });

  update();

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
