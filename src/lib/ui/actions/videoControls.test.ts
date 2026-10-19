import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { videoControls } from './videoControls';

let node: HTMLDivElement;
let chrome: HTMLElement;
let button: HTMLButtonElement;
let action: ReturnType<typeof videoControls>;
const idle = () => node.hasAttribute('data-video-idle');
beforeEach(() => {
  vi.useFakeTimers();
  node = document.createElement('div');
  node.innerHTML = '<header data-video-controls><button>Control</button></header><div data-background></div>';
  document.body.appendChild(node);
  chrome = node.querySelector('header')!; button = node.querySelector('button')!;
});
afterEach(() => { action?.destroy(); node.remove(); vi.useRealTimers(); });

it('keeps audio, paused video and other non-enabled views visible', () => {
  action = videoControls(node, { enabled: false });
  vi.advanceTimersByTime(30000);
  expect(idle()).toBe(false);
  action.update({ enabled: true }); vi.advanceTimersByTime(1000);
  action.update({ enabled: false }); vi.advanceTimersByTime(10000);
  expect(idle()).toBe(false); expect(chrome.inert).toBe(false);
});

it('hides idle video chrome without letting playback-clock updates restart the timer', () => {
  action = videoControls(node, { enabled: true });
  for (let i = 0; i < 30; i++) { action.update({ enabled: true }); vi.advanceTimersByTime(100); }
  expect(idle()).toBe(true); expect(chrome.inert).toBe(true);
  expect(chrome.getAttribute('aria-hidden')).toBe('true');
  node.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
  expect(idle()).toBe(false); expect(chrome.inert).toBe(false);
  expect(chrome.hasAttribute('aria-hidden')).toBe(false);
  vi.advanceTimersByTime(2399); expect(idle()).toBe(false);
  vi.advanceTimersByTime(1); expect(idle()).toBe(true);
});

it('holds controls visible while hovering, then hides after leaving', () => {
  action = videoControls(node, { enabled: true });
  button.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
  vi.advanceTimersByTime(10000); expect(idle()).toBe(false);
  node.dispatchEvent(new MouseEvent('pointerleave'));
  vi.advanceTimersByTime(2400); expect(idle()).toBe(true);
});

it('reveals controls for keyboard users and keeps focused controls accessible', () => {
  action = videoControls(node, { enabled: true });
  vi.advanceTimersByTime(2400); expect(idle()).toBe(true);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
  expect(chrome.inert).toBe(false);
  button.focus(); vi.advanceTimersByTime(10000);
  expect(idle()).toBe(false);
  node.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
  vi.advanceTimersByTime(2400); expect(idle()).toBe(true);
});

it('does not hide an open dropdown or timer menu; closing it starts a fresh idle period', async () => {
  action = videoControls(node, { enabled: true });
  button.setAttribute('aria-expanded', 'true'); await Promise.resolve();
  vi.advanceTimersByTime(10000); expect(idle()).toBe(false);
  button.setAttribute('aria-expanded', 'false'); await Promise.resolve();
  vi.advanceTimersByTime(2300); expect(idle()).toBe(false);
  vi.advanceTimersByTime(100); expect(idle()).toBe(true);
});

it('restores visible controls and clears scheduled work on destruction', () => {
  action = videoControls(node, { enabled: true });
  vi.advanceTimersByTime(2400); expect(idle()).toBe(true);
  action.destroy(); vi.advanceTimersByTime(10000);
  expect(idle()).toBe(false); expect(chrome.inert).toBe(false);
});
