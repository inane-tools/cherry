import { beforeEach, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';
import type { AuthSession, Playlist, Track } from '$lib/core/models';

const api = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn(), record: vi.fn(), refresh: vi.fn(), notify: vi.fn(), upload: vi.fn(), attach: vi.fn(), meta: vi.fn() }));
vi.mock('./auth', () => ({ authStore: writable<AuthSession | null>(null) }));
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({
  addTracksToPlaylist: api.add, removeTrackFromPlaylist: api.remove, getActiveChannel: () => 'channel',
  setPlaylistCustomThumbnail: api.attach, getPlaylistMeta: api.meta,
}));
vi.mock('./playlists', () => ({
  openPlaylistStore: writable(null), openPlaylistTracks: writable([]),
  playlistStore: writable([]), refreshEditedPlaylist: api.refresh, recordPlaylistRemoval: api.record,
}));
vi.mock('./addablePlaylists', () => ({ addablePlaylistsStore: writable([]) }));
vi.mock('./contextMenu', () => ({ notify: api.notify }));
vi.mock('./settings', () => ({ settingsStore: writable({}) }));
vi.mock('./folders', () => ({}));
vi.mock('./navigation', () => ({}));
vi.mock('./platform', () => ({ errorMessage: () => 'Could not add to the playlist.', invokeStrict: api.upload }));
vi.mock('$lib/infra/storage/cache', () => ({ cacheClear: vi.fn() }));

import { authStore } from './auth';
import { addTracksTo, removeTrackFrom, setPlaylistImage } from './playlistEdit';
import { addablePlaylistsStore } from './addablePlaylists';
import { openPlaylistStore, openPlaylistTracks, playlistStore } from './playlists';
const playlist: Playlist = { browseId: 'PLtest', title: 'Test', thumbnails: [] };
const track: Track = { videoId: 'song', title: 'Song', artists: [], thumbnails: [] };
beforeEach(() => {
  vi.clearAllMocks();
  authStore.set({ kind: 'cookie', cookie: 'SID=test', savedAt: 0 });
  api.refresh.mockResolvedValue(undefined);
  api.add.mockResolvedValue(undefined);
  api.remove.mockResolvedValue(undefined);
  api.upload.mockResolvedValue('uploaded-blob'); api.attach.mockResolvedValue(undefined); api.meta.mockResolvedValue(null);
  addablePlaylistsStore.set([playlist]);
});

it('coalesces overlapping identical adds but allows another intentional add afterward', async () => {
  let finish!: () => void;
  api.add.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const first = addTracksTo(playlist, [track]);
  const second = addTracksTo(playlist, [track]);
  expect(api.add).toHaveBeenCalledTimes(1);
  finish();
  expect(await first).toBe(true);
  expect(await second).toBe(true);
  expect(api.refresh).toHaveBeenCalledTimes(1);
  await addTracksTo(playlist, [track]);
  expect(api.add).toHaveBeenCalledTimes(2);
});

it('preserves intentional duplicates within one submission', async () => {
  await addTracksTo(playlist, [track, track]);
  expect(api.add.mock.calls[0].slice(0, 2)).toEqual(['PLtest', ['song', 'song']]);
});

it('allows retry after failure and does not refresh a failed write', async () => {
  api.add.mockRejectedValueOnce(new Error('network'));
  expect(await addTracksTo(playlist, [track])).toBe(false);
  expect(api.refresh).not.toHaveBeenCalled();
  expect(await addTracksTo(playlist, [track])).toBe(true);
  expect(api.add).toHaveBeenCalledTimes(2);
});

it('removes the chosen duplicate and ignores overlapping requests for that entry', async () => {
  const first = { ...track, playlistEntryId: 'first' };
  const second = { ...track, playlistEntryId: 'second' };
  openPlaylistStore.set(playlist); openPlaylistTracks.set([first, second]);
  let finish!: () => void;
  api.remove.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const removal = removeTrackFrom(playlist, second, 1);
  await removeTrackFrom(playlist, second, 1);
  expect(api.remove).toHaveBeenCalledTimes(1);
  expect(api.remove.mock.calls[0][3]).toEqual({ playlistEntryId: 'second', occurrence: 1 });
  finish(); await removal;
  expect(api.record).toHaveBeenCalledExactlyOnceWith(playlist, second);
});

it('does not modify local tracks when removal fails, ownership is absent, or the account changed', async () => {
  api.remove.mockRejectedValueOnce(new Error('denied'));
  await removeTrackFrom(playlist, track);
  expect(api.record).not.toHaveBeenCalled();
  addablePlaylistsStore.set([]);
  await removeTrackFrom(playlist, track);
  expect(api.remove).toHaveBeenCalledTimes(1);
  addablePlaylistsStore.set([playlist]);
  let finish!: () => void;
  api.remove.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const removal = removeTrackFrom(playlist, track);
  authStore.set({ kind: 'cookie', cookie: 'SID=other', savedAt: 0 });
  finish(); await removal;
  expect(api.record).not.toHaveBeenCalled();
});

it('keeps an uploaded new-playlist cover rather than replacing it with a lagging default', async () => {
  openPlaylistStore.set(null); playlistStore.set([playlist]);
  expect(await setPlaylistImage(playlist, 'image-bytes', 'image/png')).toBe(true);
  expect(api.attach).toHaveBeenCalledExactlyOnceWith(playlist.browseId, 'uploaded-blob', expect.anything());
  expect(api.meta).not.toHaveBeenCalled();
  expect(get(playlistStore)[0].thumbnails).toEqual([{ url: 'data:image/png;base64,image-bytes' }]);
  expect(get(addablePlaylistsStore)[0].thumbnails).toEqual([{ url: 'data:image/png;base64,image-bytes' }]);
});
