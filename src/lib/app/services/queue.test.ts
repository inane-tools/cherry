import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Track } from '$lib/core/models';
import {
  clearQueue,
  currentItem,
  cutQueueTo,
  enqueue,
  queueIndex,
  queueItems,
  removeFromQueue,
  reorderQueueTo,
  setQueue,
  setQueueState,
  setRepeat,
  setShuffle,
  step,
  upNextQueue,
} from './queue';

function track(id: string): Track {
  return { videoId: id, title: id, artists: [], thumbnails: [] };
}
function tracks(...ids: string[]): Track[] {
  return ids.map(track);
}
const current = () => get(currentItem)?.track.videoId;
const upcoming = () => get(upNextQueue).map((i) => i.track.videoId);

/** Every id that will play from the current track onwards (no repeat). */
function playRest(): string[] {
  const seen: string[] = [];
  const first = current();
  if (first) seen.push(first);
  while (step(1, true)) seen.push(current()!);
  return seen;
}

beforeEach(() => {
  setShuffle(false);
  setRepeat('off');
  clearQueue();
});

describe('linear queue', () => {
  it('starts at the requested track and steps forward', () => {
    setQueue(tracks('a', 'b', 'c'), 1);
    expect(current()).toBe('b');
    expect(upcoming()).toEqual(['c']);
    expect(step(1)).toBe(true);
    expect(current()).toBe('c');
    expect(step(1)).toBe(false);
  });

  it('wraps with repeat-all and holds with repeat-one', () => {
    setQueue(tracks('a', 'b'), 1);
    setRepeat('all');
    expect(step(1)).toBe(true);
    expect(current()).toBe('a');
    expect(step(-1)).toBe(true);
    expect(current()).toBe('b');
    step(1);
    setRepeat('one');
    // Automatic advance: the caller replays, the index stays put.
    expect(step(1)).toBe(true);
    expect(current()).toBe('a');
    // A manual skip still moves.
    expect(step(1, true)).toBe(true);
    expect(current()).toBe('b');
  });

  it('enqueues at the end, or right after the current track for play-next', () => {
    setQueue(tracks('a', 'b', 'c'), 0);
    enqueue(tracks('z'));
    enqueue(tracks('n'), true);
    expect(current()).toBe('a');
    expect(upcoming()).toEqual(['n', 'b', 'c', 'z']);
  });

  it('starts a queue when enqueueing into an empty one', () => {
    enqueue(tracks('x', 'y'));
    expect(current()).toBe('x');
  });

  it('clamps an out-of-range start index', () => {
    setQueue(tracks('a', 'b'), 99);
    expect(current()).toBe('b');
  });

  it('keeps an empty queue at index -1', () => {
    setQueue([], 0);
    expect(get(queueIndex)).toBe(-1);
    setShuffle(true);
    setQueue([], 0);
    expect(get(queueIndex)).toBe(-1);
  });
});

describe('queue editing', () => {
  it('cuts the queue to a chosen upcoming track', () => {
    setQueue(tracks('a', 'b', 'c', 'd'), 0);
    const target = get(queueItems)[2].queueId;
    expect(cutQueueTo(target)).toBe(true);
    expect(current()).toBe('c');
    expect(get(queueItems).map((i) => i.track.videoId)).toEqual(['c', 'd']);
    expect(cutQueueTo('missing')).toBe(false);
  });

  it('reorders by gap index, keeping the current track playing', () => {
    setQueue(tracks('a', 'b', 'c', 'd'), 0);
    // Upcoming: b c d. Move d into gap 0 (before b).
    const d = get(queueItems)[3].queueId;
    expect(reorderQueueTo(d, 0)).toBe(true);
    expect(current()).toBe('a');
    expect(upcoming()).toEqual(['d', 'b', 'c']);
    // Dropping a row into its own gap is a no-op.
    const b = get(queueItems).find((i) => i.track.videoId === 'b')!.queueId;
    expect(reorderQueueTo(b, 1)).toBe(false);
    expect(reorderQueueTo(b, 2)).toBe(false);
  });

  it('removes a single upcoming track', () => {
    setQueue(tracks('a', 'b', 'c'), 0);
    removeFromQueue(get(queueItems)[1].queueId);
    expect(current()).toBe('a');
    expect(upcoming()).toEqual(['c']);
  });

  it('removing the last item empties the queue', () => {
    setQueue(tracks('a'), 0);
    removeFromQueue(get(queueItems)[0].queueId);
    expect(get(queueIndex)).toBe(-1);
    expect(current()).toBeUndefined();
  });
});

describe('shuffle', () => {
  it('plays every track exactly once and starts on the chosen one', () => {
    setShuffle(true);
    setQueue(tracks('a', 'b', 'c', 'd', 'e', 'f'), 3);
    expect(current()).toBe('d');
    expect([...playRest()].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('turning shuffle off keeps the current track and restores list order', () => {
    setQueue(tracks('a', 'b', 'c', 'd'), 0);
    setShuffle(true);
    step(1);
    const playing = current();
    setShuffle(false);
    expect(current()).toBe(playing);
  });

  // Regression: enqueue() used to re-shuffle the *whole* order, so tracks that
  // had already played came back and the current track jumped to a random play
  // position (skipping a random part of the queue).
  it('enqueue keeps already-played tracks behind the current one', () => {
    setShuffle(true);
    setQueue(tracks('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'), 0);
    const played = [current()!];
    step(1);
    played.push(current()!);
    step(1);
    played.push(current()!);
    const playing = current();
    const before = upcoming();

    enqueue(tracks('x'));

    expect(current()).toBe(playing);
    const after = upcoming();
    for (const id of played) expect(after).not.toContain(id);
    expect([...after].sort()).toEqual([...before, 'x'].sort());
  });

  // Regression: "play next" under shuffle landed somewhere random.
  it('play-next under shuffle plays the added track next', () => {
    setShuffle(true);
    setQueue(tracks('a', 'b', 'c', 'd', 'e'), 0);
    step(1);
    const playing = current();
    const before = upcoming();
    enqueue(tracks('n'), true);
    expect(current()).toBe(playing);
    expect(upcoming()).toEqual(['n', ...before]);
  });
});

describe('restore', () => {
  it('rebuilds a missing order and clamps the index', () => {
    const items = tracks('a', 'b').map((t, i) => ({ track: t, queueId: `q${i}` }));
    setQueueState({ items, index: 7, order: [], shuffle: true, repeat: 'all' });
    expect(current()).toBe('b');
  });
});
