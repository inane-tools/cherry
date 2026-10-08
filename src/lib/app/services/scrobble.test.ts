import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackState, Track } from '$lib/core/models';

const sent: { track: string; timestamp: number }[] = [];
let accept: (track: string) => boolean | Promise<boolean> = () => true;

vi.mock('./lastfm', () => ({
  lastfmActive: () => true,
  nowPlaying: vi.fn(() => Promise.resolve()),
  fieldsFromTrack: (t: Track) => ({ artist: 'artist', track: t.title, duration: t.durationSeconds }),
  scrobble: vi.fn(async (fields: { track: string }, timestamp: number) => {
    const ok = await accept(fields.track);
    if (ok) sent.push({ track: fields.track, timestamp });
    return ok;
  }),
}));

const { playerStore } = await import('./player');
const { __test, flushScrobbleQueue, resetScrobbleState } = await import('./scrobble');

const QUEUE_KEY = 'cherry.scrobble.queue.v1';
const song: Track = { videoId: 'v1', title: 'Song', artists: [], thumbnails: [], durationSeconds: 100 };

function state(position: number, status: PlaybackState['status'] = 'playing'): PlaybackState {
  return { status, track: song, positionSeconds: position, durationSeconds: 100, volume: 1, muted: false };
}

/** Play `seconds` of wall time with the player reporting `playing`. */
function listen(seconds: number, from = 0): void {
  for (let s = 0; s < seconds; s++) {
    const st = state(from + s + 1);
    playerStore.set(st);
    __test.onState(st);
    __test.tick();
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  sent.length = 0;
  accept = () => true;
  localStorage.clear();
  resetScrobbleState();
});

describe('scrobble threshold', () => {
  it('scrobbles once half the track has been heard, and only once', async () => {
    __test.onState(state(0));
    listen(49);
    await settle();
    expect(sent).toHaveLength(0);
    listen(30, 49);
    await settle();
    expect(sent).toHaveLength(1);
  });

  it('ignores tracks shorter than 30 seconds', async () => {
    const short = { ...song, durationSeconds: 20 };
    for (let s = 0; s < 25; s++) {
      const st = { ...state(s), track: short, durationSeconds: 20 };
      playerStore.set(st);
      __test.onState(st);
      __test.tick();
    }
    await settle();
    expect(sent).toHaveLength(0);
  });

  // Regression: with repeat-one the same video id plays again, which used to
  // look like "still the same play", so every repeat after the first was lost.
  it('scrobbles each play of a repeated track', async () => {
    __test.onState(state(0));
    listen(99);
    await settle();
    expect(sent).toHaveLength(1);
    // The track restarts from 0.
    __test.onState(state(0));
    listen(60);
    await settle();
    expect(sent).toHaveLength(2);
  });

  it('seeking back before the scrobble point does not reset progress', async () => {
    __test.onState(state(0));
    listen(30);
    __test.onState(state(0)); // seek to start
    listen(25);
    await settle();
    expect(sent).toHaveLength(1);
  });
});

describe('offline queue', () => {
  it('queues a failed scrobble and sends it on the next flush', async () => {
    accept = () => false;
    __test.onState(state(0));
    listen(60);
    await settle();
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY)!)).toHaveLength(1);
    accept = () => true;
    await flushScrobbleQueue();
    expect(sent).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY)!)).toHaveLength(0);
  });

  // Regression: a flush overwrote the stored queue with what it read at the
  // start, dropping anything enqueued while it was waiting on Last.fm.
  it('keeps items enqueued while a flush is in flight', async () => {
    const item = (track: string, timestamp: number) => ({ fields: { artist: 'a', track }, timestamp });
    localStorage.setItem(QUEUE_KEY, JSON.stringify([item('old', 1)]));
    let release!: () => void;
    accept = () => new Promise<boolean>((resolve) => (release = () => resolve(true)));
    const flush = flushScrobbleQueue();
    await settle();
    // A new failed scrobble lands while the flush waits.
    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY)!);
    queue.push(item('new', 2));
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    release();
    await flush;
    const left = JSON.parse(localStorage.getItem(QUEUE_KEY)!);
    expect(left.map((i: { fields: { track: string } }) => i.fields.track)).toEqual(['new']);
  });

  it('runs one flush at a time', async () => {
    localStorage.setItem(QUEUE_KEY, JSON.stringify([{ fields: { artist: 'a', track: 't' }, timestamp: 1 }]));
    await Promise.all([flushScrobbleQueue(), flushScrobbleQueue()]);
    expect(sent).toHaveLength(1);
  });
});
