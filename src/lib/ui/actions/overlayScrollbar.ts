// The track is a sibling of the viewport: it never contributes to scrollHeight.
// Content/viewport changes are measured once per frame; ordinary scrolling only
// paints from cached geometry. Thumb size and position always update together.
const MIN_THUMB = 28;
const HIDE_AFTER_MS = 800;
const positionedParents = new WeakMap<HTMLElement, { count: number; original: string; changed: boolean }>();
const owners = new WeakMap<Element, HTMLElement>();
let nextId = 0;

/** Floating menus can recognize interaction with their external scrollbar. */
export function scrollbarOwner(target: EventTarget | null): HTMLElement | undefined {
  return target instanceof Element ? owners.get(target.closest('.cherry-sb-track')!) : undefined;
}

function positionParent(parent: HTMLElement): () => void {
  let state = positionedParents.get(parent);
  if (!state) {
    const position = getComputedStyle(parent).position;
    state = { count: 0, original: parent.style.position, changed: position === 'static' || !position };
    if (state.changed) parent.style.position = 'relative';
    positionedParents.set(parent, state);
  }
  state.count++;
  return () => {
    if (--state!.count) return;
    if (state!.changed && parent.style.position === 'relative') parent.style.position = state!.original;
    positionedParents.delete(parent);
  };
}

export interface OverlayScrollbarOptions {
  enabled?: boolean;
  /** Reveal only for manual input, not lyric-follow scrolling. */
  userScrollOnly?: boolean;
  /** Keep the vertical thumb below an overlaid top bar. */
  topInset?: number;
  axis?: 'x' | 'y';
}

export function overlayScrollbar(node: HTMLElement, initial: OverlayScrollbarOptions = {}) {
  const parent = node.parentElement;
  if (!parent) return;
  const releaseParent = positionParent(parent);
  const axis = initial.axis ?? 'y';
  const horizontal = axis === 'x';
  const nativeClass = horizontal ? 'cherry-overlay-scroll-x' : 'cherry-overlay-scroll';
  const hadClass = node.classList.contains(nativeClass);
  node.classList.add(nativeClass);
  const assignedId = !node.id ? `cherry-scroll-${++nextId}` : '';
  if (assignedId) node.id = assignedId;
  const track = document.createElement('div');
  track.className = `cherry-sb-track ${horizontal ? 'is-horizontal' : 'is-vertical'}`;
  track.style.zIndex = String(Math.max(5, (Number.parseInt(getComputedStyle(node).zIndex, 10) || 0) + 1));
  const thumb = document.createElement('div');
  thumb.className = 'cherry-sb-thumb';
  thumb.setAttribute('role', 'scrollbar');
  thumb.setAttribute('aria-label', node.getAttribute('aria-label') || 'Scroll');
  thumb.setAttribute('aria-controls', node.id);
  thumb.setAttribute('aria-orientation', horizontal ? 'horizontal' : 'vertical');
  thumb.setAttribute('aria-valuemin', '0');
  thumb.setAttribute('aria-valuemax', '100');
  track.appendChild(thumb);
  parent.appendChild(track);
  owners.set(track, node);

  let options = initial;
  let frame = 0;
  let destroyed = false;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let userUntil = 0;
  let viewport = 0, range = 0, length = 0, size = 0, travel = 0;
  let hasThumb = false;
  let overThumb = false;
  let drag: { id: number; anchor: number; last: number; scroll: number; factor: number } | undefined;
  const enabled = () => options.enabled !== false;
  const position = () => horizontal ? node.scrollLeft : node.scrollTop;
  const coordinate = (event: PointerEvent) => horizontal ? event.clientX : event.clientY;
  const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));

  function paint(): void {
    if (!hasThumb) return;
    const fraction = range ? clamp(position(), range) / range : 0;
    thumb.style.transform = horizontal ? `translateX(${fraction * travel}px)` : `translateY(${fraction * travel}px)`;
    thumb.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
  }
  function clearHide(): void {
    if (hideTimer !== undefined) clearTimeout(hideTimer);
    hideTimer = undefined;
  }
  function hide(): void {
    if (!drag && !overThumb && document.activeElement !== thumb) thumb.classList.remove('is-visible');
  }
  function reveal(): void {
    if (!enabled() || !hasThumb) return;
    thumb.classList.add('is-visible');
    clearHide();
    if (!drag && !overThumb && document.activeElement !== thumb) hideTimer = setTimeout(hide, HIDE_AFTER_MS);
  }
  function setPosition(value: number): void {
    if (horizontal) node.scrollLeft = clamp(value, range);
    else node.scrollTop = clamp(value, range);
    paint();
  }
  function measure(): void {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (destroyed) return;
    viewport = horizontal ? node.clientWidth : node.clientHeight;
    const content = horizontal ? node.scrollWidth : node.scrollHeight;
    const inset = horizontal ? 0 : clamp(options.topInset ?? 0, viewport);
    length = Math.max(0, viewport - inset);
    range = Math.max(0, content - viewport);
    size = Math.min(length, Math.max(MIN_THUMB, content ? length * viewport / content : 0));
    travel = Math.max(0, length - size);
    hasThumb = enabled() && viewport > 0 && range > 1 && travel > 0;
    track.hidden = !hasThumb;
    thumb.tabIndex = hasThumb ? 0 : -1;
    // Layout offsets keep the track aligned inside translated/scaled sheets.
    track.style.left = `${node.offsetLeft + node.clientLeft + (horizontal ? 0 : node.clientWidth - 12)}px`;
    track.style.top = `${node.offsetTop + node.clientTop + (horizontal ? node.clientHeight - 12 : inset)}px`;
    track.style.width = `${horizontal ? viewport : 12}px`;
    track.style.height = `${horizontal ? 12 : length}px`;
    thumb.style.width = horizontal ? `${size}px` : '4px';
    thumb.style.height = horizontal ? '4px' : `${size}px`;
    if (!hasThumb) {
      endDrag();
      clearHide();
      thumb.classList.remove('is-visible');
    } else if (drag) {
      // Rebase to the current pointer/scroll position when streamed content
      // changes the mapping. A resize must never move the page by itself.
      const rect = track.getBoundingClientRect();
      const scale = (horizontal ? rect.width : rect.height) / length || 1;
      drag.anchor = drag.last;
      drag.scroll = position();
      drag.factor = range / travel / scale;
    }
    paint();
  }
  function schedule(): void {
    if (!destroyed && !frame) frame = requestAnimationFrame(measure);
  }
  function onScroll(): void {
    paint();
    if (!options.userScrollOnly || drag || performance.now() < userUntil) reveal();
  }
  function onUserScroll(event: Event): void {
    if (event instanceof KeyboardEvent && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
    userUntil = performance.now() + 1200;
    if (options.userScrollOnly) reveal();
  }
  function onEnter(): void { if (!options.userScrollOnly) reveal(); }
  function onLeave(event: MouseEvent): void {
    const target = event.relatedTarget;
    if (target instanceof Node && (node.contains(target) || track.contains(target))) return;
    hide();
  }
  function onThumbEnter(): void { overThumb = true; reveal(); }
  function onThumbLeave(event: MouseEvent): void { overThumb = false; onLeave(event); }
  function onMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.id) return;
    drag.last = coordinate(event);
    setPosition(drag.scroll + (drag.last - drag.anchor) * drag.factor);
  }
  function endDrag(): void {
    const previous = drag;
    drag = undefined;
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    window.removeEventListener('blur', endDrag);
    if (previous) {
      try { thumb.releasePointerCapture(previous.id); } catch { /* capture already lost */ }
      if (!destroyed) reveal();
    }
  }
  function onUp(event: PointerEvent): void { if (event.pointerId === drag?.id) endDrag(); }
  function onDown(event: PointerEvent): void {
    if (event.button !== 0 || drag || !enabled()) return;
    measure();
    if (!hasThumb) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = track.getBoundingClientRect();
    const scale = (horizontal ? rect.width : rect.height) / length || 1;
    drag = { id: event.pointerId, anchor: coordinate(event), last: coordinate(event), scroll: position(), factor: range / travel / scale };
    reveal();
    try { thumb.setPointerCapture(event.pointerId); } catch { /* window listeners cover capture failure */ }
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('blur', endDrag);
  }
  function onKey(event: KeyboardEvent): void {
    const forward = horizontal ? 'ArrowRight' : 'ArrowDown';
    const backward = horizontal ? 'ArrowLeft' : 'ArrowUp';
    let next = position();
    if (event.key === forward) next += 40;
    else if (event.key === backward) next -= 40;
    else if (event.key === 'PageDown' || event.key === ' ') next += viewport * (event.shiftKey ? -0.9 : 0.9);
    else if (event.key === 'PageUp') next -= viewport * 0.9;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = range;
    else return;
    event.preventDefault();
    event.stopPropagation();
    setPosition(next);
    reveal();
  }
  function onThumbWheel(event: WheelEvent): void {
    if (!hasThumb) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = horizontal ? event.deltaX || event.deltaY : event.deltaY;
    setPosition(position() + delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport : 1));
    reveal();
  }
  function stopClick(event: Event): void { event.stopPropagation(); }

  node.addEventListener('scroll', onScroll, { passive: true });
  node.addEventListener('wheel', onUserScroll, { passive: true });
  node.addEventListener('touchmove', onUserScroll, { passive: true });
  node.addEventListener('keydown', onUserScroll);
  node.addEventListener('mouseenter', onEnter);
  node.addEventListener('mouseleave', onLeave);
  node.addEventListener('load', schedule, true);
  node.addEventListener('input', schedule);
  thumb.addEventListener('pointerdown', onDown);
  thumb.addEventListener('lostpointercapture', endDrag);
  thumb.addEventListener('keydown', onKey);
  thumb.addEventListener('focus', reveal);
  thumb.addEventListener('blur', hide);
  thumb.addEventListener('mouseenter', onThumbEnter);
  thumb.addEventListener('mouseleave', onThumbLeave);
  track.addEventListener('click', stopClick);
  track.addEventListener('mousedown', stopClick);
  thumb.addEventListener('wheel', onThumbWheel, { passive: false });

  const resize = new ResizeObserver(schedule);
  resize.observe(node);
  resize.observe(parent);
  const siblings = new Set<Element>();
  function observeLayout(): void {
    const children = new Set(Array.from(parent!.children).filter(child => child !== node && !child.classList.contains('cherry-sb-track')));
    for (const child of siblings) if (!children.has(child)) { resize.unobserve(child); siblings.delete(child); }
    for (const child of children) if (!siblings.has(child)) { resize.observe(child); siblings.add(child); }
  }
  observeLayout();
  const contentResize = new ResizeObserver(schedule);
  const observed = new Set<Element>();
  function observeContent(): void {
    const children = new Set(Array.from(node.children).filter(child => !child.classList.contains('cherry-sb-track')));
    for (const child of observed) if (!children.has(child)) { contentResize.unobserve(child); observed.delete(child); }
    for (const child of children) if (!observed.has(child)) { contentResize.observe(child); observed.add(child); }
  }
  observeContent();
  const mutate = new MutationObserver(records => {
    if (records.some(record => record.target === node && record.type === 'childList')) observeContent();
    schedule();
  });
  mutate.observe(node, { childList: true, subtree: true, characterData: true });
  const hostMutate = new MutationObserver(records => {
    if (!records.some(record => [...record.addedNodes, ...record.removedNodes].some(child => child instanceof Element && !child.classList.contains('cherry-sb-track')))) return;
    observeLayout();
    schedule();
  });
  hostMutate.observe(parent, { childList: true });
  // Portalled menus can move without changing size; follow their position too.
  const placement = new MutationObserver(schedule);
  placement.observe(node, { attributes: true, attributeFilter: ['style', 'class'] });
  window.addEventListener('resize', schedule);
  measure();

  return {
    update(next: OverlayScrollbarOptions = {}): void {
      if (next.enabled === options.enabled && next.topInset === options.topInset && next.userScrollOnly === options.userScrollOnly) return;
      options = next;
      if (!enabled()) { endDrag(); clearHide(); thumb.classList.remove('is-visible'); }
      schedule();
    },
    destroy(): void {
      destroyed = true;
      endDrag();
      clearHide();
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      contentResize.disconnect();
      mutate.disconnect();
      hostMutate.disconnect();
      placement.disconnect();
      window.removeEventListener('resize', schedule);
      node.removeEventListener('scroll', onScroll);
      node.removeEventListener('wheel', onUserScroll);
      node.removeEventListener('touchmove', onUserScroll);
      node.removeEventListener('keydown', onUserScroll);
      node.removeEventListener('mouseenter', onEnter);
      node.removeEventListener('mouseleave', onLeave);
      node.removeEventListener('load', schedule, true);
      node.removeEventListener('input', schedule);
      track.remove();
      owners.delete(track);
      if (!hadClass) node.classList.remove(nativeClass);
      if (assignedId && node.id === assignedId) node.removeAttribute('id');
      releaseParent();
    },
  };
}
