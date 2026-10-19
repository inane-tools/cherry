import { afterEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const events = vi.hoisted(() => new Map<string, (event: { payload: string }) => void>());
vi.mock('$lib/desktop/event', () => ({ listen: vi.fn(async (name, handler) => { events.set(name, handler); return () => events.delete(name); }) }));
vi.mock('./platform', () => ({ isDesktop: () => true, invokeSafe: vi.fn(async () => null) }));
vi.mock('./player', async () => {
  const { writable } = await import('svelte/store');
  return { playerStore: writable({ status: 'playing', track: { videoId: 'song', title: 'Song', artists: [{ name: 'Artist' }], thumbnails: [] }, positionSeconds: 20, durationSeconds: 100, volume: 0.8, muted: false }), toggle: vi.fn(), next: vi.fn(), prev: vi.fn(), seekTo: vi.fn(), setVolume: vi.fn(), setMuted: vi.fn(), toggleShuffle: vi.fn() };
});
vi.mock('./queue', async () => {
  const { writable } = await import('svelte/store');
  return { repeatMode: writable('off'), shuffleMode: writable(false), setRepeat: vi.fn() };
});
vi.mock('./pins', async () => ({ pinnedStore: (await import('svelte/store')).writable([{ browseId: 'VLPIN', title: 'Pinned' }]) }));
vi.mock('./settings', async () => ({ settingsStore: (await import('svelte/store')).writable({ recentPlaylists: [{ browseId: 'VLRECENT', title: 'Recent' }, { browseId: 'VLPIN', title: 'Pinned' }] }) }));
vi.mock('./navigation', () => ({ openPage: vi.fn() }));
vi.mock('./overlays', () => ({ closeSearch: vi.fn(), closeSettings: vi.fn() }));
vi.mock('./auth', async () => ({ authStore: (await import('svelte/store')).writable({ cookie: 'session' }) }));
vi.mock('./playlists', async () => ({ playlistStore: (await import('svelte/store')).writable([]), playPlaylist: vi.fn() }));

import { startTray } from './tray';
import { invokeSafe } from './platform';
import { playerStore, toggle } from './player';
import { playPlaylist } from './playlists';
import { setRepeat } from './queue';
import { openPage } from './navigation';
import { closeSettings, closeSearch } from './overlays';
import { pinnedStore } from './pins';

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it('updates song info and shortcuts without rebuilding for playback position ticks', async () => {
  vi.useFakeTimers();
  const stop = await startTray();
  await vi.advanceTimersByTimeAsync(100);
  expect(invokeSafe).toHaveBeenCalledWith('update_tray', { state: expect.objectContaining({ title: 'Song', artist: 'Artist', playing: true, pinned: [{ browseId: 'VLPIN', title: 'Pinned', thumbnail: '' }] }) });
  expect(invokeSafe).toHaveBeenCalledWith('update_jump_list', { pinned: [{ browseId: 'VLPIN', title: 'Pinned', thumbnail: '' }], recent: [{ browseId: 'VLRECENT', title: 'Recent', thumbnail: '' }] });
  const calls = vi.mocked(invokeSafe).mock.calls.length;
  const timers = vi.getTimerCount();
  playerStore.set({ ...get(playerStore), positionSeconds: 21 });
  expect(vi.getTimerCount()).toBe(timers);
  await vi.advanceTimersByTimeAsync(100);
  expect(vi.mocked(invokeSafe).mock.calls).toHaveLength(calls);
  stop();
  expect(events.size).toBe(0);
});

it('routes playback controls and playlist selections, and stops listening on cleanup', async () => {
  vi.useFakeTimers();
  const stop = await startTray();
  const send = (payload: string) => events.get('tray://action')?.({ payload });
  send('toggle');
  send('repeat:one');
  send('playlist:VLPIN');
  await Promise.resolve();
  expect(toggle).toHaveBeenCalledOnce();
  expect(setRepeat).toHaveBeenCalledWith('one');
  expect(playPlaylist).toHaveBeenCalledWith({ browseId: 'VLPIN', title: 'Pinned', thumbnails: [] });
  stop();
  await vi.advanceTimersByTimeAsync(1000);
  expect(vi.mocked(invokeSafe).mock.calls.some(([command]) => command === 'update_tray')).toBe(false);
});


it('opens Jump List selections without playing them and closes covering overlays', async () => {
  const stop = await startTray();
  events.get('tray://action')?.({ payload: 'open-playlist:VLPIN' });
  await Promise.resolve();
  expect(openPage).toHaveBeenCalledWith({ view: 'playlist', entity: { browseId: 'VLPIN', title: 'Pinned', thumbnails: [] } });
  expect(playPlaylist).not.toHaveBeenCalled();
  expect(closeSettings).toHaveBeenCalled(); expect(closeSearch).toHaveBeenCalled();
  stop();
});
it('opens a cold-start playlist launch after registering native action handlers', async () => {
  vi.mocked(invokeSafe).mockImplementation(async command => command === 'take_playlist_launch' ? 'VLCOLD' : null);
  const stop = await startTray();
  expect(openPage).toHaveBeenCalledWith({ view: 'playlist', entity: { browseId: 'VLCOLD', title: 'Playlist', thumbnails: [] } });
  expect(playPlaylist).not.toHaveBeenCalled(); stop();
  vi.mocked(invokeSafe).mockImplementation(async () => null);
});

it('keeps album, artist and song sidebar pins out of playlist-only native shortcuts', async () => {
  vi.useFakeTimers();
  const previous = get(pinnedStore);
  pinnedStore.set([
    ...previous,
    { kind: 'album', browseId: 'MPRalbum', title: 'Album', album: { browseId: 'MPRalbum', title: 'Album', artists: [], thumbnails: [] } },
    { kind: 'artist', browseId: 'UCartist', title: 'Artist', artist: { browseId: 'UCartist', name: 'Artist' } },
    { kind: 'song', browseId: 'song:video', title: 'Song', track: { videoId: 'video', title: 'Song', artists: [], thumbnails: [] } },
  ]);
  const stop = await startTray();
  try {
    await vi.advanceTimersByTimeAsync(100);
    expect(invokeSafe).toHaveBeenCalledWith('update_jump_list', { pinned: [{ browseId: 'VLPIN', title: 'Pinned', thumbnail: '' }], recent: [{ browseId: 'VLRECENT', title: 'Recent', thumbnail: '' }] });
  } finally { stop(); pinnedStore.set(previous); }
});
