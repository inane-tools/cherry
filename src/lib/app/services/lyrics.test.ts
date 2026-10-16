import { beforeEach, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), timing: vi.fn() }));
vi.mock('$lib/infra/ytmusic/lyricsTiming', () => ({ lookupLyrics: mocks.timing }));
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({ getTrackLyrics: mocks.fetch, getActiveChannel: () => 'channel' }));
vi.mock('./player', () => ({ playerStore: writable({ track: { videoId: 'a' } }), videoMode: writable(false) }));
vi.mock('./auth', () => ({ authStore: writable<unknown>({ cookie: 'one' }) }));
vi.mock('./account', () => ({ activeChannelStore: writable(null) }));
vi.mock('./settings', () => ({ settingsStore: writable({ lyricsEnabled: true }), updateSettings: vi.fn() }));
import { playerStore, videoMode } from './player';
import { authStore } from './auth';
import { settingsStore, updateSettings } from './settings';
import { activeLyricAt, lyricsStore, startLyrics, toggleLyrics } from './lyrics';
const data = { synced: true, lines: [{ text: 'First', startSeconds: 1, endSeconds: 3 }, { text: 'Second', startSeconds: 5, endSeconds: 7 }] };
it('shows nothing when neither lyrics source has a result', async () => {
  authStore.set({ kind: 'cookie', cookie: 'missing', savedAt: 0 });
  settingsStore.update(s => ({ ...s, lyricsLookupEnabled: true }));
  mocks.fetch.mockResolvedValue(null);
  const stop = startLyrics();
  try {
    await vi.waitFor(() => expect(get(lyricsStore)).toEqual({ status: 'missing', data: null }));
    expect(mocks.timing).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledOnce();
  } finally { stop(); }
});
beforeEach(() => {
  mocks.fetch.mockReset(); mocks.timing.mockReset().mockResolvedValue(null);
  settingsStore.update(s => ({ ...s, lyricsLookupEnabled: false }));
});
it('finds LRCLIB lyrics before the strip is enabled and does not reload when toggled', async () => {
  authStore.set({ kind: 'cookie', cookie: 'lookup-off-test', savedAt: 0 });
  settingsStore.update(s => ({ ...s, lyricsEnabled: false, lyricsLookupEnabled: true }));
  mocks.fetch.mockResolvedValue(null);
  mocks.timing.mockResolvedValue(data);
  const stop = startLyrics();
  try {
    await vi.waitFor(() => expect(get(lyricsStore)).toEqual({ status: 'ready', data }));
    settingsStore.update(s => ({ ...s, lyricsEnabled: true }));
    expect(get(lyricsStore).status).toBe('ready');
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.timing).toHaveBeenCalledOnce();
  } finally { stop(); }
});
it('serializes quick lyrics toggles instead of saving the same stale value twice', async () => {
  settingsStore.update(s => ({ ...s, lyricsEnabled: false }));
  vi.mocked(updateSettings).mockImplementation(async patch => { settingsStore.update(s => ({ ...s, ...patch })); });
  vi.mocked(updateSettings).mockClear();
  toggleLyrics(); toggleLyrics();
  await vi.waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(2));
  expect(updateSettings).toHaveBeenNthCalledWith(1, { lyricsEnabled: true });
  expect(updateSettings).toHaveBeenNthCalledWith(2, { lyricsEnabled: false });
  expect(get(settingsStore).lyricsEnabled).toBe(false);
});
it('does not publish untimed lyrics as ready while synchronized lyrics are still loading', async () => {
  authStore.set({ kind: 'cookie', cookie: 'timing-test', savedAt: 0 });
  settingsStore.update(s => ({ ...s, lyricsEnabled: true, lyricsLookupEnabled: true }));
  const plain = { synced: false, lines: [{ text: 'First' }] };
  mocks.fetch.mockResolvedValue(plain);
  let resolve!: (value: typeof data | null) => void;
  mocks.timing.mockImplementation(() => new Promise(done => { resolve = done; }));
  const stop = startLyrics();
  try {
    await vi.waitFor(() => expect(mocks.timing).toHaveBeenCalledOnce());
    expect(get(lyricsStore)).toEqual({ status: 'loading', data: null });
    expect(mocks.fetch).not.toHaveBeenCalled();
    resolve(data);
    await vi.waitFor(() => expect(get(lyricsStore)).toEqual({ status: 'ready', data }));
  } finally { stop(); }
});
it('only publishes the untimed result after timing lookup confirms there is none', async () => {
  authStore.set({ kind: 'cookie', cookie: 'plain-test', savedAt: 0 });
  settingsStore.update(s => ({ ...s, lyricsEnabled: true, lyricsLookupEnabled: true }));
  const plain = { synced: false, lines: [{ text: 'First' }] };
  mocks.fetch.mockResolvedValue(plain);
  let resolve!: (value: null) => void;
  mocks.timing.mockImplementation(() => new Promise(done => { resolve = done; }));
  const stop = startLyrics();
  try {
    await vi.waitFor(() => expect(mocks.timing).toHaveBeenCalledOnce());
    expect(get(lyricsStore).status).toBe('loading');
    resolve(null);
    await vi.waitFor(() => expect(get(lyricsStore)).toEqual({ status: 'ready', data: plain }));
  } finally { stop(); }
});
it('suspends lyrics in video mode, ignores pending results and resumes on returning to audio', async () => {
  authStore.set({ kind: 'cookie', cookie: 'one', savedAt: 0 });
  const pending: ((value: typeof data) => void)[] = [];
  mocks.fetch.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  const stop = startLyrics();
  try {
    videoMode.set(true);
    pending[0](data); await Promise.resolve();
    expect(get(lyricsStore)).toEqual({ status: 'idle', data: null });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    videoMode.set(false);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  } finally { stop(); videoMode.set(false); }
});
it('respects instrumental gaps and seeking backwards', () => {
  expect(activeLyricAt(data, 0)).toBe(-1); expect(activeLyricAt(data, 2)).toBe(0);
  expect(activeLyricAt(data, 4)).toBe(-1); expect(activeLyricAt(data, 6)).toBe(1);
  expect(activeLyricAt(data, 2)).toBe(0);
});
it('ignores old-track responses and does not refetch on position updates', async () => {
  const pending: ((value: typeof data) => void)[] = [];
  mocks.fetch.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  const stop = startLyrics();
  try {
    playerStore.update(s => ({ ...s, track: { ...s.track!, videoId: 'b' } }));
    pending[0](data); await Promise.resolve();
    expect(get(lyricsStore).status).toBe('loading');
    pending[1](data);
    await vi.waitFor(() => expect(get(lyricsStore).status).toBe('ready'));
    playerStore.update(s => ({ ...s, positionSeconds: 3 }));
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  } finally { stop(); }
});
it('clears stale lyrics when disabled or signed out while a request is pending', async () => {
  let resolve!: (value: typeof data) => void;
  mocks.fetch.mockImplementation(() => new Promise(done => { resolve = done; }));
  const stop = startLyrics();
  try {
    authStore.set(null); resolve(data); await Promise.resolve();
    expect(get(lyricsStore)).toEqual({ status: 'idle', data: null });
    settingsStore.update(s => ({ ...s, lyricsEnabled: false }));
    expect(get(lyricsStore).status).toBe('idle');
  } finally { stop(); }
});
