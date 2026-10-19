import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { overlayScrollbar, scrollbarOwner } from './overlayScrollbar';

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
const observers: { callback: () => void; targets: Set<Element>; disconnect: ReturnType<typeof vi.fn> }[] = [];
const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers(); frames = new Map(); nextFrame = 0; observers.length = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  vi.stubGlobal('ResizeObserver', class {
    state = { callback: () => {}, targets: new Set<Element>(), disconnect: vi.fn() };
    constructor(callback: () => void) { this.state.callback = callback; observers.push(this.state); }
    observe(target: Element) { this.state.targets.add(target); }
    unobserve(target: Element) { this.state.targets.delete(target); }
    disconnect() { this.state.disconnect(); this.state.targets.clear(); }
  });
});
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(performance.now())); }
function fixture(options: Parameters<typeof overlayScrollbar>[1] = {}) {
  const parent = document.createElement('div'); parent.style.position = 'static';
  const node = document.createElement('div');
  const child = document.createElement('div'); node.append(child); parent.append(node); document.body.append(parent);
  const dimensions = { height: 200, content: 1000, width: 300, wideContent: 1500 };
  const contentRead = vi.fn(() => dimensions.content);
  Object.defineProperties(node, {
    clientHeight: { get: () => dimensions.height }, scrollHeight: { get: contentRead },
    clientWidth: { get: () => dimensions.width }, scrollWidth: { get: () => dimensions.wideContent },
    offsetTop: { value: 12 }, offsetLeft: { value: 10 },
  });
  const action = overlayScrollbar(node, options)!;
  cleanups.push(() => action.destroy());
  const track = parent.querySelector<HTMLElement>('.cherry-sb-track')!;
  const thumb = track.firstElementChild as HTMLElement;
  return { node, parent, child, dimensions, contentRead, action, track, thumb };
}
function pointer(target: EventTarget, type: string, x: number, y: number, id = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: id }); target.dispatchEvent(event);
}

it('keeps its geometry outside the scrolling content and respects the top bar inset', () => {
  const f = fixture({ topInset: 48 });
  expect(f.node.querySelector('.cherry-sb-thumb')).toBeNull();
  expect(f.track.parentElement).toBe(f.parent);
  expect(f.track.style.top).toBe('60px');
  expect(parseFloat(f.thumb.style.height)).toBeCloseTo(30.4);
  f.node.scrollTop = 400; f.node.dispatchEvent(new Event('scroll'));
  expect(f.thumb.style.transform).toBe('translateY(60.8px)');
  expect(f.contentRead).toHaveBeenCalledTimes(1);
  expect(f.thumb.getAttribute('aria-valuenow')).toBe('50');
  expect(scrollbarOwner(f.thumb)).toBe(f.node);
});

it('coalesces streamed content measurements and updates size and position atomically', async () => {
  const f = fixture(); f.node.scrollTop = 400;
  f.dimensions.content = 40000;
  for (let i = 0; i < 20; i++) observers.forEach(observer => observer.callback());
  f.node.appendChild(document.createElement('div')); await Promise.resolve();
  expect(frames.size).toBe(1); expect(f.contentRead).toHaveBeenCalledTimes(1);
  flush();
  expect(f.contentRead).toHaveBeenCalledTimes(2);
  expect(parseFloat(f.thumb.style.height)).toBe(28);
  const position = parseFloat(f.thumb.style.transform.slice('translateY('.length));
  expect(position).toBeCloseTo(400 / 39800 * 172);
  expect(f.node.scrollTop).toBe(400);
  expect(observers[1].targets.size).toBe(2);
});

it('hides playback-driven scrolling and hover but reveals manual lyric scrolling', () => {
  const f = fixture({ userScrollOnly: true });
  f.node.scrollTop = 100; f.node.dispatchEvent(new Event('scroll')); f.node.dispatchEvent(new Event('mouseenter'));
  expect(f.thumb.classList.contains('is-visible')).toBe(false);
  f.node.dispatchEvent(new WheelEvent('wheel', { deltaY: 50 }));
  expect(f.thumb.classList.contains('is-visible')).toBe(true);
  vi.advanceTimersByTime(1300); f.node.scrollTop = 300; f.node.dispatchEvent(new Event('scroll'));
  expect(f.thumb.classList.contains('is-visible')).toBe(false);
  f.node.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }));
  expect(f.thumb.classList.contains('is-visible')).toBe(true);
});

it('does not hide or flicker when the pointer moves from content onto the external thumb', () => {
  const f = fixture();
  f.node.dispatchEvent(new Event('mouseenter'));
  f.node.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: f.thumb }));
  f.thumb.dispatchEvent(new Event('mouseenter'));
  vi.advanceTimersByTime(2000);
  expect(f.thumb.classList.contains('is-visible')).toBe(true);
  f.thumb.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: f.node }));
  expect(f.thumb.classList.contains('is-visible')).toBe(true);
  f.node.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: document.body }));
  expect(f.thumb.classList.contains('is-visible')).toBe(false);
});

it('supports horizontal scrolling, keyboard controls and wheel input over the thumb', () => {
  const f = fixture({ axis: 'x' });
  f.node.scrollLeft = 600; f.node.dispatchEvent(new Event('scroll'));
  expect(f.thumb.style.width).toBe('60px');
  expect(f.thumb.style.transform).toBe('translateX(120px)');
  f.thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  expect(f.node.scrollLeft).toBe(1200);
  f.thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  f.thumb.dispatchEvent(new WheelEvent('wheel', { deltaY: 3, deltaMode: 1, cancelable: true }));
  expect(f.node.scrollLeft).toBe(48);
});

it('rebases a drag after content growth without moving the page on resize', () => {
  const f = fixture();
  pointer(f.thumb, 'pointerdown', 0, 0);
  pointer(window, 'pointermove', 0, 40);
  expect(f.node.scrollTop).toBe(200);
  f.dimensions.content = 2000;
  observers.forEach(observer => observer.callback()); flush();
  expect(f.node.scrollTop).toBe(200);
  pointer(window, 'pointermove', 0, 50);
  expect(f.node.scrollTop).toBeCloseTo(200 + 10 * 1800 / 172);
  pointer(window, 'pointermove', 0, 1000, 2);
  expect(f.node.scrollTop).toBeCloseTo(200 + 10 * 1800 / 172);
  pointer(window, 'pointerup', 0, 50);
  pointer(window, 'pointermove', 0, 150);
  expect(f.node.scrollTop).toBeCloseTo(200 + 10 * 1800 / 172);
});

it('clamps short tracks and overscroll and updates enabled/inset options', () => {
  const f = fixture();
  f.node.scrollTop = 5000; f.node.dispatchEvent(new Event('scroll'));
  expect(f.thumb.style.transform).toBe('translateY(160px)');
  f.node.scrollTop = -20; f.node.dispatchEvent(new Event('scroll'));
  expect(f.thumb.style.transform).toBe('translateY(0px)');
  f.action.update({ enabled: false }); flush(); expect(f.track.hidden).toBe(true);
  f.action.update({ topInset: 100 }); flush(); expect(f.track.hidden).toBe(false);
  expect(f.track.style.top).toBe('112px');
  f.dimensions.height = 20; observers[0].callback(); flush();
  expect(f.track.hidden).toBe(true);
});

it('cleans up observers, drag listeners, timers and temporary parent positioning', () => {
  const f = fixture(); expect(f.parent.style.position).toBe('relative');
  pointer(f.thumb, 'pointerdown', 0, 0); observers[0].callback();
  f.action.destroy(); cleanups.pop();
  expect(f.parent.style.position).toBe('static');
  expect(f.parent.querySelector('.cherry-sb-track')).toBeNull();
  expect(f.node.id).toBe(''); expect(frames.size).toBe(0);
  expect(observers.every(observer => observer.disconnect.mock.calls.length === 1)).toBe(true);
  pointer(window, 'pointermove', 0, 100); expect(f.node.scrollTop).toBe(0);
});

it('shares a positioned parent safely between sibling scroll areas', () => {
  const f = fixture(); const second = document.createElement('div'); f.parent.append(second);
  const other = overlayScrollbar(second)!;
  f.action.destroy(); cleanups.pop();
  expect(f.parent.style.position).toBe('relative');
  other.destroy(); expect(f.parent.style.position).toBe('static');
});
