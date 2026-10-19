/** Paint the scrolling page banner behind the title bar in the content column. */
export function entityBackdrop(node: HTMLElement) {
  const header = node.parentElement;
  const scroller = header?.closest<HTMLElement>('main');
  const host = scroller?.parentElement?.closest<HTMLElement>('[data-page-content]')
    ?.querySelector<HTMLElement>('[data-page-backdrop-host]');
  if (!header || !scroller || !host) return;

  host.appendChild(node);
  node.style.left = '0';
  node.style.right = '0';
  node.style.top = '0';
  node.style.bottom = 'auto';
  const cover = header.querySelector<HTMLElement>('[data-entity-cover]');

  function scroll() {
    node.style.transform = `translateY(${-scroller!.scrollTop}px)`;
  }
  function measure() {
    // Geometry changes only with layout. Scrolling uses the cached banner size
    // and a transform rather than reading layout on every frame.
    const hostTop = host!.getBoundingClientRect().top;
    const origin = header!.getBoundingClientRect().top + scroller!.scrollTop - hostTop;
    node.style.height = `${Math.max(0, origin + header!.offsetHeight)}px`;
    if (cover) {
      const start = Math.max(0, cover.getBoundingClientRect().top + scroller!.scrollTop - hostTop);
      node.style.setProperty('--entity-fade-start', `${start}px`);
      node.style.setProperty('--entity-fade-end', `${start + cover.offsetHeight}px`);
    }
    scroll();
  }
  const observer = new ResizeObserver(measure);
  observer.observe(header);
  observer.observe(scroller);
  observer.observe(host);
  if (cover) observer.observe(cover);
  scroller.addEventListener('scroll', scroll, { passive: true });
  measure();
  return { destroy() {
    observer.disconnect();
    scroller.removeEventListener('scroll', scroll);
    node.remove();
  } };
}
