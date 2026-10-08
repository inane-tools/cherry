import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { QueueItem } from '$lib/core/models';
import { clearQueue, currentItem, setQueue, setShuffle, step } from './queue';
import { boundedQueue, clearStoredQueue, flushQueue, readStoredQueue, rememberPosition, restoreQueue } from './queuePersistence';

const item = (i: number): QueueItem => ({
  queueId: `q${i}`,
  track: { videoId: `v${i}`, title: `t${i}`, artists: [], thumbnails: [] },
});

beforeEach(() => {
  setShuffle(false);
  clearQueue();
  clearStoredQueue();
  localStorage.clear();
});

describe('queue persistence', () => {
  it('round-trips the queue, shuffle order and position', () => {
    setShuffle(true);
    setQueue(Array.from({ length: 6 }, (_, i) => item(i).track), 2);
    step(1);
    const playing = get(currentItem)?.track.videoId;
    rememberPosition(42.4);
    flushQueue();

    clearQueue();
    setShuffle(false);
    expect(restoreQueue()).toBe(42);
    expect(get(currentItem)?.track.videoId).toBe(playing);
  });

  it('writes at most once per second while playing (throttle, not debounce)', () => {
    vi.useFakeTimers();
    try {
      setQueue([item(0).track], 0);
      for (let t = 0; t < 8; t++) {
        rememberPosition(t);
        vi.advanceTimersByTime(250);
      }
      expect(readStoredQueue()?.position).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an empty queue removes the stored copy', () => {
    setQueue([item(0).track], 0);
    flushQueue();
    clearQueue();
    flushQueue();
    expect(readStoredQueue()).toBeNull();
  });
});

describe('boundedQueue', () => {
  it('keeps short queues untouched', () => {
    const items = [item(0), item(1)];
    expect(boundedQueue(items, 1, [1, 0])).toEqual({ items, index: 1, order: [1, 0] });
  });

  // Regression: only `items` was truncated, so order/index no longer matched.
  it('stores an over-long queue from the current track on, in play order', () => {
    const items = Array.from({ length: 2500 }, (_, i) => item(i));
    const order = items.map((_, i) => 2499 - i); // reversed play order
    const bounded = boundedQueue(items, 10, order);
    expect(bounded.items).toHaveLength(2000);
    expect(bounded.index).toBe(0);
    expect(bounded.items[0].queueId).toBe('q2489'); // play position 10
    expect(bounded.order).toEqual(bounded.items.map((_, i) => i));
  });
});
