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
  setActiveChannel: vi.fn(),
  getMusicVideo: vi.fn(async () => ({ videoId: 'official', title: 'Official video', artists: [], thumbnails: [], isMusicVideo: true })),
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
  delete window.cherryDesktop;
  playImpl = () => Promise.resolve();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    return playImpl(this);
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  pending.length = 0;
  clearQueue();
  player.videoMode.set(false);
  player.videoPreferred.set(false);
  setShuffle(false);
  authStore.set({ kind: 'cookie', cookie: 'SID=x', savedAt: 0 } satisfies AuthSession);
});

describe('music video playback', () => {
  it('prepares a restored video without autoplaying or losing the remembered position', async () => {
    const { settingsStore } = await import('./settings');
    localStorage.setItem('cherry.queue.v1', JSON.stringify({
      items: [{ queueId: 'restored', track: track('restored') }],
      index: 0, order: [0], shuffle: false, repeat: 'off', position: 42,
    }));
    player.playerStore.update(state => ({ ...state, track: null, status: 'idle' }));
    settingsStore.update(settings => ({ ...settings, videoPreferred: true }));
    try {
      await player.restorePlayback();
      await flush();
      expect(get(player.videoPreferred)).toBe(true);
      expect(pending[0].videoId).toBe('official');
      pending[0].resolve('https://media/restored-video');
      await flush();
      expect(get(player.videoMode)).toBe(true);
      expect(get(player.playerStore).status).toBe('paused');
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    } finally {
      localStorage.removeItem('cherry.queue.v1');
      settingsStore.update(settings => ({ ...settings, videoPreferred: false }));
      await player.stopPlayback();
    }
  });
  it('falls back to audio without starting a paused track when no counterpart exists', async () => {
    const { getMusicVideo } = await import('$lib/infra/ytmusic/InnertubeClient');
    vi.mocked(getMusicVideo).mockResolvedValueOnce(null);
    const start = player.playTracks([track('no-video')]); await flush(); pending[0].resolve('https://media/song'); await start;
    player.playerStore.update(s => ({ ...s, status: 'paused', positionSeconds: 23 }));
    const switched = player.setVideoMode(true); await flush();
    expect(get(player.videoMode)).toBe(false);
    expect(get(player.videoPreferred)).toBe(true);
    expect(pending[1].videoId).toBe('no-video');
    pending[1].resolve('https://media/song'); await switched;
    expect(get(player.playerStore).status).toBe('paused');
    await player.stopPlayback();
  });
  it('returns to video on the next compatible track after an audio-only song', async () => {
    const { getMusicVideo } = await import('$lib/infra/ytmusic/InnertubeClient');
    const start = player.playTracks([track('audio-only'), track('has-video')]);
    await flush(); pending[0].resolve('https://media/song'); await start;
    vi.mocked(getMusicVideo).mockResolvedValueOnce(null);
    const enable = player.setVideoMode(true);
    await flush(); pending[1].resolve('https://media/song'); await enable;
    expect(get(player.videoPreferred)).toBe(true);
    expect(get(player.videoMode)).toBe(false);
    const { prefetchAudioStream } = await import('$lib/infra/ytmusic/InnertubeClient');
    await flush();
    expect(prefetchAudioStream).toHaveBeenCalledWith('official', expect.anything(), { video: true });
    const advance = player.next();
    await flush();
    expect(pending[2].videoId).toBe('official');
    pending[2].resolve('https://media/video'); await advance;
    expect(get(player.videoMode)).toBe(true);
    expect(get(player.videoPreferred)).toBe(true);
    await player.stopPlayback(); await player.setVideoMode(false);
  });
  it('allows turning video preference off while an audio-only track is playing', async () => {
    const { getMusicVideo } = await import('$lib/infra/ytmusic/InnertubeClient');
    const start = player.playTracks([track('audio-only'), track('has-video')]);
    await flush(); pending[0].resolve('https://media/song'); await start;
    vi.mocked(getMusicVideo).mockResolvedValueOnce(null);
    const enable = player.setVideoMode(true);
    await flush(); pending[1].resolve('https://media/song'); await enable;
    const disable = player.setVideoMode(false);
    await flush(); pending[2].resolve('https://media/song'); await disable;
    const advance = player.next();
    await flush();
    expect(pending[3].videoId).toBe('has-video');
    pending[3].resolve('https://media/song2'); await advance;
    expect(get(player.videoPreferred)).toBe(false);
    expect(get(player.videoMode)).toBe(false);
    await player.stopPlayback();
  });
  it('replaces the audio element, preserves position and ignores late old-element events', async () => {
    const start = player.playTracks([track('a')]); await flush();
    pending[0].resolve('https://media/a'); await start;
    const old = vi.mocked(HTMLMediaElement.prototype.play).mock.contexts.at(-1) as HTMLMediaElement;
    player.playerStore.update(s => ({ ...s, status: 'playing', positionSeconds: 42 }));
    const host = document.createElement('div'); const surface = player.videoSurface(host);
    const switchMode = player.setVideoMode(true); await flush();
    expect(pending[1].videoId).toBe('official');
    pending[1].resolve('https://media/video'); await switchMode;
    const video = host.querySelector('video')!;
    expect(video).toBeInstanceOf(HTMLVideoElement);
    Object.defineProperty(video, 'duration', { value: 200, configurable: true });
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(video.currentTime).toBe(42);
    video.dispatchEvent(new Event('play'));
    old.dispatchEvent(new Event('pause'));
    expect(get(player.playerStore).status).toBe('playing');
    await player.stopPlayback(); await player.setVideoMode(false); surface.destroy();
  });
  it('does not start playback when switching a paused song to video', async () => {
    const start = player.playTracks([track('paused')]); await flush(); pending[0].resolve('https://media/paused'); await start;
    player.playerStore.update(s => ({ ...s, status: 'paused', positionSeconds: 20 }));
    const calls = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;
    const switched = player.setVideoMode(true); await flush(); pending[1].resolve('https://media/video'); await switched;
    expect(get(player.playerStore).status).toBe('paused');
    expect(vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length).toBe(calls);
    await player.stopPlayback(); await player.setVideoMode(false);
  });
});

describe('loadCurrent', () => {
  it('does not start a stream that resolves after Stop', async () => {
    const done = player.playTracks([track('a')]);
    await flush();
    await player.stopPlayback();
    pending[0].resolve('https://media/a');
    await done;
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(get(player.playerStore)).toMatchObject({ status: 'idle', track: null, durationSeconds: 0 });
  });

  it('does not retry a stream failure after Stop', async () => {
    const done = player.playTracks([track('a')]);
    await flush();
    await player.stopPlayback();
    pending[0].reject(new Error('HTTP 403'));
    await done;
    expect(pending).toHaveLength(1);
    expect(get(player.playerStore).status).toBe('idle');
  });

  it('does not start a stream that resolves after sign-out clears the queue', async () => {
    player.warmup();
    const done = player.playTracks([track('a')]);
    await flush();
    clearQueue();
    authStore.set(null);
    pending[0].resolve('https://media/a');
    await done;
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(get(player.playerStore)).toMatchObject({ status: 'idle', track: null });
  });

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

describe('runtime media failures', () => {
  it('refreshes a failing stream once and resumes from the same position', async () => {
    const started = player.playTracks([track('runtime')]); await flush();
    pending[0].resolve('https://media/first'); await started;
    const media = vi.mocked(HTMLMediaElement.prototype.play).mock.contexts.at(-1) as HTMLMediaElement;
    media.currentTime = 37;
    player.playerStore.update(s => ({ ...s, status: 'playing', positionSeconds: 37 }));
    media.dispatchEvent(new Event('error')); await flush();
    expect(pending[1]).toMatchObject({ videoId: 'runtime', refresh: true });
    pending[1].resolve('https://media/refreshed'); await flush();
    await vi.waitFor(() => expect(media.src).toBe('https://media/refreshed'));
    media.dispatchEvent(new Event('play'));
    await flush();
    media.dispatchEvent(new Event('loadedmetadata'));
    expect(media.currentTime).toBe(37);
    media.dispatchEvent(new Event('error')); await flush();
    expect(pending).toHaveLength(2);
    expect(get(player.playerStore).status).toBe('error');
    await player.stopPlayback();
  });
  it('uses the native range relay for Googlevideo progressive playback', async () => {
    Object.defineProperty(window, 'cherryDesktop', { configurable: true, value: { invoke: vi.fn(async () => null) } });
    const started = player.playTracks([track('relay')]);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending[0].resolve('https://rr1.googlevideo.com/video?sig=a%2Bb'); await started;
    const media = vi.mocked(HTMLMediaElement.prototype.play).mock.contexts.at(-1) as HTMLMediaElement;
    const source = new URL(media.src);
    expect(source.protocol).toBe('cherry-media:');
    expect(source.searchParams.get('url')).toBe('https://rr1.googlevideo.com/video?sig=a%2Bb');
    await player.stopPlayback();
    delete window.cherryDesktop;
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
