import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async (_cmd: string, _args?: unknown): Promise<unknown> => undefined) }));
vi.mock('$lib/desktop/core', () => ({ invoke }));
vi.mock('./platform', () => ({ isDesktop: () => true, invokeSafe: (cmd: string, args?: unknown) => invoke(cmd, args) }));
vi.mock('./settings', async () => ({ settingsStore: (await import('svelte/store')).writable({ discordEnabled: true, discordStatusDisplay: 'details' }), updateSettings: vi.fn() }));
vi.mock('./auth', async () => ({ authStore: (await import('svelte/store')).writable(null) }));
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({ getAudioStream: vi.fn(async () => ({ track: {}, stream: { url: 'https://media.test/song', mimeType: 'audio/mp4' } })), getInnertube: vi.fn(async () => ({})), prefetchAudioStream: vi.fn() }));
vi.mock('./queuePersistence', () => ({ rememberPosition: vi.fn(), restoreQueue: vi.fn(), watchQueue: vi.fn() }));
vi.mock('./theme', () => ({ applyArtworkTheme: vi.fn(), resetArtworkTheme: vi.fn() }));
import { playerStore, refreshDiscord, stopPlayback, startPresenceKeepAlive, restorePlayback, playTracks, toggle } from './player';
import { restoreQueue } from './queuePersistence';
import { setQueue } from './queue';
import { settingsStore } from './settings';
import { authStore } from './auth';

const track = { videoId: 'song-id', title: 'Song', artists: [{ name: 'Artist' }], thumbnails: [] };
let audio: HTMLAudioElement;
async function flush() { for (let i = 0; i < 15; i++) await Promise.resolve(); }
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Audio', function () { audio = document.createElement('audio'); return audio; });
  authStore.set({ kind: 'cookie', cookie: 'SID=synthetic', savedAt: 0 });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) { this.dispatchEvent(new Event('play')); return Promise.resolve(); });
  invoke.mockReset().mockResolvedValue(undefined);
  settingsStore.update((s) => ({ ...s, discordEnabled: true }));
  playerStore.update((s) => ({ ...s, track, status: 'playing' }));
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('clears after an in-flight write on Stop, and never replays its old snapshot', async () => {
  let finish!: () => void;
  let began!: () => void;
  const started = new Promise<void>((resolve) => { began = resolve; });
  invoke.mockImplementation(async (cmd) => {
    if (cmd === 'discord_set_presence') await new Promise<void>((resolve) => { finish = resolve; began(); });
  });
  const update = refreshDiscord();
  await started;
  expect(invoke).toHaveBeenCalledWith('discord_set_presence', expect.objectContaining({ payload: expect.objectContaining({ videoId: 'song-id' }) }));
  const stopped = stopPlayback();
  await flush();
  finish();
  await Promise.all([update, stopped]);
  const commands = invoke.mock.calls.map(([cmd]) => cmd).filter((cmd) => cmd.startsWith('discord_'));
  expect(commands).toEqual(['discord_set_presence', 'discord_clear_presence']);
});

it('clears disabled and failed playback instead of advertising it', async () => {
  settingsStore.update((s) => ({ ...s, discordEnabled: false }));
  await refreshDiscord();
  settingsStore.update((s) => ({ ...s, discordEnabled: true }));
  playerStore.update((s) => ({ ...s, status: 'error' }));
  await refreshDiscord();
  expect(invoke.mock.calls.map(([cmd]) => cmd)).toEqual(['discord_clear_presence', 'discord_clear_presence']);
});

it('clears a long pause and keep-alive never restores it', async () => {
  await stopPlayback();
  await playTracks([track]);
  audio.dispatchEvent(new Event('pause'));
  await flush();
  startPresenceKeepAlive();
  await vi.advanceTimersByTimeAsync(60_001);
  expect(get(playerStore).status).toBe('paused');
  invoke.mockClear();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(invoke.mock.calls.filter(([cmd]) => cmd === 'discord_set_presence')).toHaveLength(0);
});

it('keeps restored startup metadata off Discord until the audio actually plays', async () => {
  await stopPlayback();
  vi.mocked(restoreQueue).mockImplementationOnce(() => { setQueue([track]); return 12; });
  invoke.mockClear();
  await restorePlayback();
  await refreshDiscord();
  expect(get(playerStore).status).toBe('paused');
  expect(invoke.mock.calls.some(([cmd]) => cmd === 'discord_set_presence')).toBe(false);
  expect(invoke.mock.calls.some(([cmd]) => cmd === 'discord_clear_presence')).toBe(true);
  await toggle();
  await flush();
  await vi.advanceTimersByTimeAsync(4101);
  expect(invoke).toHaveBeenCalledWith('discord_set_presence', expect.objectContaining({ payload: expect.objectContaining({ videoId: track.videoId, isPlaying: true }) }));
});
