import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { frameOpacity } from './frameOpacity';

let callbacks: Map<number, FrameRequestCallback>;
let serial: number;
beforeEach(() => {
  document.documentElement.classList.add('cherry-linux-window');
  callbacks = new Map();
  serial = 0;
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => {
  document.documentElement.classList.remove('cherry-linux-window');
  vi.unstubAllGlobals();
});

function advance(now: number) {
  const pending = [...callbacks.values()];
  callbacks.clear();
  pending.forEach((callback) => callback(now));
}

it('reverses a fade from the current opacity without jumping', () => {
  const node = document.createElement('div');
  const action = frameOpacity(node, { visible: false, duration: 100 });
  action.update?.({ visible: true, duration: 100 });
  advance(50);
  expect(Number(node.style.opacity)).toBeCloseTo(0.5);
  vi.mocked(performance.now).mockReturnValue(50);
  action.update?.({ visible: false, duration: 100 });
  expect(Number(node.style.opacity)).toBeCloseTo(0.5);
  advance(150);
  expect(node.style.opacity).toBe('0');
  expect(callbacks.size).toBe(0);
});

it('cancels pending frames and restores styles when the image is removed', () => {
  const node = document.createElement('div');
  node.style.opacity = '0.8';
  node.style.transitionProperty = 'opacity';
  const action = frameOpacity(node, { visible: false, duration: 100 });
  action.update?.({ visible: true, duration: 100 });
  action.destroy?.();
  expect(callbacks.size).toBe(0);
  expect(node.style.opacity).toBe('0.8');
  expect(node.style.transitionProperty).toBe('opacity');
});

it('respects reduced motion', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const node = document.createElement('div');
  const action = frameOpacity(node, { visible: false, duration: 100 });
  action.update?.({ visible: true, duration: 100 });
  expect(node.style.opacity).toBe('1');
  expect(callbacks.size).toBe(0);
});

it('leaves other platforms on their existing CSS fades', () => {
  document.documentElement.classList.remove('cherry-linux-window');
  const node = document.createElement('div');
  node.style.opacity = '0.8';
  const action = frameOpacity(node, { visible: false, duration: 100 });
  expect(action.update).toBeUndefined();
  expect(node.style.opacity).toBe('0.8');
});
