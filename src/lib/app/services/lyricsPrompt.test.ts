import { afterEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { createLyricsPrompt } from './lyricsPrompt';

afterEach(() => vi.useRealTimers());
it('dismisses after five seconds without restarting on playback updates or reopening the player', () => {
  vi.useFakeTimers(); const prompt = createLyricsPrompt();
  try {
    prompt.update('queue-a', true); expect(get(prompt.visible)).toBe(true);
    vi.advanceTimersByTime(4000); prompt.update('queue-a', true);
    vi.advanceTimersByTime(999); expect(get(prompt.visible)).toBe(true);
    vi.advanceTimersByTime(1); expect(get(prompt.visible)).toBe(false);
    prompt.update('queue-a', false); prompt.update('queue-a', true);
    expect(get(prompt.visible)).toBe(false);
    prompt.update('queue-b', true); expect(get(prompt.visible)).toBe(true);
  } finally { prompt.destroy(); }
});
it('starts only when untimed lyrics can be shown and cancels stale timers on song changes', () => {
  vi.useFakeTimers(); const prompt = createLyricsPrompt();
  try {
    prompt.update('queue-a', false); vi.advanceTimersByTime(10000);
    expect(get(prompt.visible)).toBe(false);
    prompt.update('queue-a', true); vi.advanceTimersByTime(3000);
    prompt.update('queue-b', false); vi.advanceTimersByTime(3000);
    prompt.update('queue-b', true); vi.advanceTimersByTime(4999);
    expect(get(prompt.visible)).toBe(true);
    vi.advanceTimersByTime(1); expect(get(prompt.visible)).toBe(false);
    prompt.update('queue-c', true); prompt.destroy();
    expect(vi.getTimerCount()).toBe(0);
  } finally { prompt.destroy(); }
});
