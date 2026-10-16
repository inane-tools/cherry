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
vi.mock('./auth', async () => ({ authStore: (await import('svelte/store')).writable({ cookie: 'session' }) }));
vi.mock('./playlists', async () => ({ playlistStore: (await import('svelte/store')).writable([]), playPlaylist: vi.fn() }));

import { startTray } from './tray';
import { invokeSafe } from './platform';
import { playerStore, toggle } from './player';
import { playPlaylist } from './playlists';
import { setRepeat } from './queue';

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it('updates song info and shortcuts without rebuilding for playback position ticks', async () => {
  vi.useFakeTimers();
  const stop = await startTray();
  await vi.advanceTimersByTimeAsync(100);
  expect(invokeSafe).toHaveBeenCalledWith('update_tray', { state: expect.objectContaining({ title: 'Song', artist: 'Artist', playing: true, pinned: [{ browseId: 'VLPIN', title: 'Pinned', thumbnail: '' }] }) });
  expect(invokeSafe).toHaveBeenCalledWith('update_jump_list', { pinned: [{ browseId: 'VLPIN', title: 'Pinned', thumbnail: '' }], recent: [{ browseId: 'VLRECENT', title: 'Recent', thumbnail: '' }] });
  const calls = vi.mocked(invokeSafe).mock.calls.length;
  playerStore.set({ ...get(playerStore), positionSeconds: 21 });
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
