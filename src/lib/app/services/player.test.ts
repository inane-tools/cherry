import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { AuthSession, Track } from '$lib/core/models';

// Stream resolution is controlled per test: each call returns a deferred the
// test resolves when it wants, so overlapping loads can be ordered exactly.
interface Pending {
  videoId: string;
  refresh: boolean;
  resolve: (url: string) => void;
  reject: (e: unknown) => void;
}
const pending: Pending[] = [];

vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({
  getInnertube: vi.fn(() => Promise.resolve({})),
  prefetchAudioStream: vi.fn(() => Promise.resolve()),
  getAudioStream: vi.fn(
    (videoId: string, _session: unknown, options: { refresh?: boolean } = {}) =>
      new Promise((resolve, reject) => {
        pending.push({
          videoId,
          refresh: Boolean(options.refresh),
          resolve: (url) =>
            resolve({ track: { durationSeconds: 200 }, stream: { url, mimeType: 'audio/mp4' } }),
          reject,
        });
      }),
  ),
}));
vi.mock('./theme', () => ({
  applyArtworkTheme: vi.fn(() => Promise.resolve()),
  resetArtworkTheme: vi.fn(),
}));

const { authStore } = await import('./auth');
const player = await import('./player');
const { clearQueue, setShuffle, setRepeat, queueStore } = await import('./queue');

function track(id: string): Track {
  return { videoId: id, title: id, artists: [{ name: 'artist' }], thumbnails: [] };
}

/** Let queued microtasks (awaits inside loadCurrent) run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

let playImpl: (el: HTMLMediaElement) => Promise<void>;

beforeEach(() => {
  pending.length = 0;
  clearQueue();
  setShuffle(false);
  authStore.set({ kind: 'cookie', cookie: 'SID=x', savedAt: 0 } satisfies AuthSession);
  playImpl = () => Promise.resolve();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    return playImpl(this);
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});

describe('loadCurrent', () => {
  it('plays the resolved stream of the current track', async () => {
    const done = player.playTracks([track('a'), track('b')]);
    await flush();
    expect(pending.map((p) => p.videoId)).toEqual(['a']);
    pending[0].resolve('https://media/a');
    await done;
    const st = get(player.playerStore);
    expect(st.track?.videoId).toBe('a');
    expect(st.durationSeconds).toBe(200);
  });

  // Regression: a slow resolve for a track the user already skipped past must
  // not replace the newer track's source.
  it('ignores a stream that resolves after the user skipped', async () => {
    const first = player.playTracks([track('a'), track('b')]);
    await flush();
    const second = player.next();
    await flush();
    const [a, b] = pending;
    b.resolve('https://media/b');
    await second;
    a.resolve('https://media/a');
    await first;
    expect(get(player.playerStore).track?.videoId).toBe('b');
    expect(pending.filter((p) => p.refresh)).toHaveLength(0);
  });

  // Regression: the AbortError from an interrupted play() was treated as an
  // expired URL, so the *old* track was re-resolved and set as the source again.
  it('does not retry the previous track when its play() is aborted by a skip', async () => {
    let abortFirst: (() => void) | null = null;
    playImpl = (el) =>
      el.src.endsWith('/a')
        ? new Promise((_, reject) => {
            abortFirst = () => reject(new DOMException('interrupted', 'AbortError'));
          })
        : Promise.resolve();

    const first = player.playTracks([track('a'), track('b')]);
    await flush();
    pending[0].resolve('https://media/a');
    await flush();
    const second = player.next();
    await flush();
    pending[1].resolve('https://media/b');
    await second;
    abortFirst!();
    await first;

    expect(pending.some((p) => p.videoId === 'a' && p.refresh)).toBe(false);
    expect(get(player.playerStore).track?.videoId).toBe('b');
    expect(get(player.playerStore).status).not.toBe('error');
  });

  it('retries once with a fresh stream after a failure, then reports the error', async () => {
    const done = player.playTracks([track('a')]);
    await flush();
    pending[0].reject(new Error('HTTP 403'));
    await flush();
    expect(pending[1]).toMatchObject({ videoId: 'a', refresh: true });
    pending[1].reject(new Error('HTTP 403'));
    await done;
    expect(get(player.playerStore).status).toBe('error');
  });

  it('a successful retry clears the error path', async () => {
    const done = player.playTracks([track('a')]);
    await flush();
    pending[0].reject(new Error('expired'));
    await flush();
    pending[1].resolve('https://media/a2');
    await done;
    expect(get(player.playerStore).status).not.toBe('error');
  });

  it('leaves the track paused when autoplay is blocked', async () => {
    playImpl = () => Promise.reject(new DOMException('no gesture', 'NotAllowedError'));
    const done = player.playTracks([track('a')]);
    await flush();
    pending[0].resolve('https://media/a');
    await done;
    expect(get(player.playerStore).status).toBe('paused');
    expect(pending).toHaveLength(1);
  });

  it('refuses to play without a session', async () => {
    authStore.set(null);
    await player.playTracks([track('a')]);
    expect(pending).toHaveLength(0);
  });
});

describe('end of track', () => {
  async function playToEnd(ids: string[]): Promise<HTMLAudioElement> {
    const done = player.playTracks(ids.map(track));
    await flush();
    pending[0].resolve('https://media/0');
    await done;
    // The player owns a single <audio>; find it through a spy on play().
    const el = vi.mocked(HTMLMediaElement.prototype.play).mock.contexts.at(-1) as HTMLAudioElement;
    return el;
  }

  it('stop-after-track cues the next song paused instead of playing it', async () => {
    const el = await playToEnd(['a', 'b']);
    player.stopAfterTrack.set(true);
    el.dispatchEvent(new Event('ended'));
    await flush();
    const st = get(player.playerStore);
    expect(st.track?.videoId).toBe('b');
    expect(st.status).toBe('paused');
    expect(pending).toHaveLength(1); // nothing new was resolved
    expect(get(player.stopAfterTrack)).toBe(false);
  });

  it('without the flag the next track plays', async () => {
    const el = await playToEnd(['a', 'b']);
    el.dispatchEvent(new Event('ended'));
    await flush();
    expect(pending.map((p) => p.videoId)).toEqual(['a', 'b']);
  });
});

describe('shuffle / repeat controls', () => {
  it('cycles repeat off → all → one → off', () => {
    setRepeat('off');
    expect(player.cycleRepeat()).toBe('all');
    expect(player.cycleRepeat()).toBe('one');
    expect(player.cycleRepeat()).toBe('off');
    expect(get(queueStore.repeat)).toBe('off');
  });

  it('toggles shuffle', () => {
    player.toggleShuffle();
    expect(get(queueStore.shuffle)).toBe(true);
    player.toggleShuffle();
    expect(get(queueStore.shuffle)).toBe(false);
  });
});
