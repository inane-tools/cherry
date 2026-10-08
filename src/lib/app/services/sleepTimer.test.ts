import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';

const fades: { ms: number; signal?: AbortSignal }[] = [];
const player = writable({ status: 'playing' });
const stopAfter = writable(false);
vi.mock('./player', () => ({
  playerStore: player,
  stopAfterTrack: stopAfter,
  fadeOutAndPause: vi.fn((ms: number, signal?: AbortSignal) => {
    fades.push({ ms, signal });
    return Promise.resolve();
  }),
}));

const timer = await import('./sleepTimer');

beforeEach(() => {
  vi.useFakeTimers();
  fades.length = 0;
  player.set({ status: 'playing' });
  timer.cancelSleepTimer();
});
afterEach(() => vi.useRealTimers());

describe('sleep timer', () => {
  it('starts fading so the music stops exactly at the deadline', async () => {
    timer.startSleepTimer(1, 0);
    expect(get(timer.sleepTimerStore)).toEqual({ mode: 'time', endsAt: 60_000, minutes: 1 });
    vi.advanceTimersByTime(60_000 - timer.FADE_MS - 1);
    expect(fades).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(fades).toEqual([expect.objectContaining({ ms: timer.FADE_MS })]);
    await vi.runAllTimersAsync();
    expect(get(timer.sleepTimerStore).mode).toBe('off');
  });

  it('does nothing at expiry if the music is already paused', async () => {
    timer.startSleepTimer(1);
    player.set({ status: 'paused' });
    await vi.runAllTimersAsync();
    expect(fades).toHaveLength(0);
    expect(get(timer.sleepTimerStore).mode).toBe('off');
  });

  it('cancelling stops the pending timer', () => {
    timer.startSleepTimer(5);
    timer.cancelSleepTimer();
    vi.advanceTimersByTime(10 * 60_000);
    expect(fades).toHaveLength(0);
  });

  it('a new timer replaces the old one', () => {
    timer.startSleepTimer(5, 0);
    timer.startSleepTimer(1, 0);
    vi.advanceTimersByTime(60_000);
    expect(fades).toHaveLength(1);
    vi.advanceTimersByTime(10 * 60_000);
    expect(fades).toHaveLength(1);
  });

  it('end-of-track mode arms the player and reads off once it fires', () => {
    timer.sleepAfterTrack();
    expect(get(stopAfter)).toBe(true);
    expect(get(timer.sleepTimerStore).mode).toBe('track');
    stopAfter.set(false); // the player consumed it
    expect(get(timer.sleepTimerStore).mode).toBe('off');
  });

  it('switching from end-of-track to a timed timer disarms the player', () => {
    timer.sleepAfterTrack();
    timer.startSleepTimer(10);
    expect(get(stopAfter)).toBe(false);
    expect(get(timer.sleepTimerStore).mode).toBe('time');
  });

  it('formats the countdown', () => {
    expect(timer.formatCountdown(0)).toBe('0:00');
    expect(timer.formatCountdown(65)).toBe('1:05');
    expect(timer.formatCountdown(3725)).toBe('1:02:05');
    expect(timer.secondsLeft({ mode: 'time', endsAt: 10_500, minutes: 1 }, 0)).toBe(11);
    expect(timer.secondsLeft({ mode: 'off' })).toBe(0);
  });
});
