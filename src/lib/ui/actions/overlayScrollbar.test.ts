import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { overlayScrollbar } from './overlayScrollbar';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('hides playback scrolling and hover, but reveals manual scroll input', () => {
  const node = document.createElement('div');
  Object.defineProperty(node, 'clientHeight', { value: 200 });
  Object.defineProperty(node, 'scrollHeight', { value: 1000 });
  const action = overlayScrollbar(node, { userScrollOnly: true });
  const thumb = node.querySelector('.cherry-sb-thumb')!;
  node.scrollTop = 100; node.dispatchEvent(new Event('scroll'));
  node.dispatchEvent(new Event('mouseenter'));
  expect(thumb.classList.contains('is-visible')).toBe(false);
  node.dispatchEvent(new WheelEvent('wheel', { deltaY: 50 }));
  node.dispatchEvent(new Event('scroll'));
  expect(thumb.classList.contains('is-visible')).toBe(true);
  vi.advanceTimersByTime(1300);
  node.scrollTop = 300; node.dispatchEvent(new Event('scroll'));
  expect(thumb.classList.contains('is-visible')).toBe(false);
  node.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }));
  expect(thumb.classList.contains('is-visible')).toBe(true);
  action.destroy();
});

it('keeps normal scrollbar behavior unchanged outside lyrics', () => {
  const node = document.createElement('div');
  Object.defineProperty(node, 'clientHeight', { value: 200 });
  Object.defineProperty(node, 'scrollHeight', { value: 1000 });
  const action = overlayScrollbar(node);
  node.dispatchEvent(new Event('scroll'));
  expect(node.querySelector('.cherry-sb-thumb')!.classList.contains('is-visible')).toBe(true);
  action.destroy();
});
