import { beforeEach, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';
import type { AuthSession, Playlist, Track } from '$lib/core/models';

const api = vi.hoisted(() => ({ channel: 'channel', add: vi.fn(), remove: vi.fn(), create: vi.fn(), rename: vi.fn(), description: vi.fn(), localRename: vi.fn(), localAdd: vi.fn(), recordLibrary: vi.fn(), prepend: vi.fn(), record: vi.fn(), refresh: vi.fn(), notify: vi.fn(), upload: vi.fn(), attach: vi.fn(), meta: vi.fn(), imageContext: vi.fn() }));
vi.mock('./auth', () => ({ authStore: writable<AuthSession | null>(null) }));
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({
  addTracksToPlaylist: api.add, removeTrackFromPlaylist: api.remove, getActiveChannel: () => api.channel,
  createPlaylist: api.create, renamePlaylist: api.rename, setPlaylistDescription: api.description,
  setPlaylistCustomThumbnail: api.attach, getPlaylistMeta: api.meta, getPlaylistImageContext: api.imageContext,
}));
vi.mock('./playlists', () => ({
  openPlaylistStore: writable(null), openPlaylistTracks: writable([]),
  playlistStore: writable([]), refreshEditedPlaylist: api.refresh, recordPlaylistRemoval: api.record, recordLibraryPlaylist: api.recordLibrary,
}));
vi.mock('./addablePlaylists', () => ({ addablePlaylistsStore: writable([]), renamePlaylistLocally: api.localRename, addPlaylistLocally: api.localAdd }));
vi.mock('./contextMenu', () => ({ notify: api.notify }));
vi.mock('./settings', () => ({ settingsStore: writable({}) }));
vi.mock('./folders', () => ({ prependSidebarItem: api.prepend }));
vi.mock('./navigation', () => ({}));
vi.mock('./platform', () => ({ errorMessage: () => 'Could not add to the playlist.', invokeStrict: api.upload }));
vi.mock('$lib/infra/storage/cache', () => ({ cacheClear: vi.fn(), cacheGet: vi.fn(() => null) }));

import { authStore } from './auth';
import { addTracksTo, removeTrackFrom, setPlaylistImage, createNewPlaylist, saveTrack, updatePlaylistDetails } from './playlistEdit';
import { addablePlaylistsStore } from './addablePlaylists';
import { openPlaylistStore, openPlaylistTracks, playlistStore } from './playlists';
import { activeChannelStore } from './channelProfile';
import { settingsStore } from './settings';
const playlist: Playlist = { browseId: 'PLtest', title: 'Test', thumbnails: [] };
const track: Track = { videoId: 'song', title: 'Song', artists: [], thumbnails: [] };
beforeEach(() => {
  vi.clearAllMocks();
  activeChannelStore.set(null);
  api.channel = 'channel';
  authStore.set({ kind: 'cookie', cookie: 'SID=test', savedAt: 0 });
  api.refresh.mockResolvedValue(undefined);
  api.add.mockResolvedValue(undefined);
  api.remove.mockResolvedValue(undefined);
  api.upload.mockResolvedValue('uploaded-blob'); api.attach.mockResolvedValue(undefined); api.meta.mockResolvedValue(null);
  api.imageContext.mockResolvedValue({ clientVersion: 'test-version', visitorData: 'visitor' });
  api.create.mockResolvedValue('VLcreated'); api.rename.mockResolvedValue(undefined); api.description.mockResolvedValue(undefined);
  api.recordLibrary.mockImplementation((item: Playlist, patch?: Partial<Playlist>) => {
    playlistStore.update(list => list.map(p => p.browseId === item.browseId ? { ...p, ...patch } : p));
  });
  addablePlaylistsStore.set([playlist]);
});

it('invalidates an old edit even after switching away and back to the same brand', async () => {
  let finish!: () => void;
  api.rename.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const pending = updatePlaylistDetails(playlist, 'Renamed', 'Description');
  activeChannelStore.set({ name: 'B', pageId: 'b' });
  activeChannelStore.set({ name: 'A', pageId: 'a' });
  finish(); expect(await pending).toBe(false);
  expect(api.description).not.toHaveBeenCalled(); expect(api.recordLibrary).not.toHaveBeenCalled();
});

it('does not send the second half of an edit or change the new brand after switching', async () => {
  let finish!: () => void;
  api.rename.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const pending = updatePlaylistDetails(playlist, 'Renamed', 'Description');
  api.channel = 'other-brand'; finish();
  expect(await pending).toBe(false);
  expect(api.description).not.toHaveBeenCalled();
  expect(api.recordLibrary).not.toHaveBeenCalled();
  expect(api.localRename).not.toHaveBeenCalled();
});

it('retains a confirmed rename even if saving the description fails', async () => {
  api.description.mockRejectedValueOnce(new Error('denied'));
  expect(await updatePlaylistDetails(playlist, 'Renamed', 'Description')).toBe(false);
  expect(api.recordLibrary).toHaveBeenCalledWith(playlist, { title: 'Renamed' });
});

it('does not add a newly created playlist to the next brand when creation finishes late', async () => {
  let finish!: (id: string) => void;
  api.create.mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
  const pending = createNewPlaylist('Created');
  api.channel = 'other-brand'; finish('VLcreated'); await pending;
  expect(api.localAdd).not.toHaveBeenCalled(); expect(api.prepend).not.toHaveBeenCalled();
});

it('never attaches an uploaded blob to a different brand after switching during upload', async () => {
  let finish!: (blob: string) => void;
  api.upload.mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
  const pending = setPlaylistImage(playlist, 'bytes', 'image/png');
  await vi.waitFor(() => expect(api.upload).toHaveBeenCalled());
  api.channel = 'other-brand'; finish('blob');
  expect(await pending).toBe(false); expect(api.attach).not.toHaveBeenCalled();
});

it('reports a cover failure inline without applying unconfirmed artwork', async () => {
  api.upload.mockRejectedValueOnce(new Error('HTTP 403'));
  const onError = vi.fn();
  expect(await setPlaylistImage(playlist, 'bytes', 'image/png', onError)).toBe(false);
  expect(onError).toHaveBeenCalled(); expect(api.recordLibrary).not.toHaveBeenCalled();
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
  expect(api.record).toHaveBeenCalledExactlyOnceWith(playlist, second, 'second');
});

it('records the entry id the server resolved when the track had none', async () => {
  openPlaylistStore.set(playlist); openPlaylistTracks.set([track]);
  api.remove.mockResolvedValueOnce('resolved-entry');
  await removeTrackFrom(playlist, track);
  expect(api.record).toHaveBeenCalledExactlyOnceWith(playlist, track, 'resolved-entry');
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

it('sends the default-playlist action through the shared confirmed refresh path', async () => {
  settingsStore.update(settings => ({ ...settings, defaultPlaylistBrowseId: playlist.browseId }));
  playlistStore.set([playlist]); openPlaylistStore.set(playlist); openPlaylistTracks.set([]);
  await saveTrack(track);
  expect(api.add).toHaveBeenCalledWith(playlist.browseId, [track.videoId], expect.anything());
  expect(api.refresh).toHaveBeenCalledWith(playlist, [track], []);
});
it('retains initial songs when a newly created playlist has not appeared in reads yet', async () => {
  expect(await createNewPlaylist('New', [track])).toBe('VLcreated');
  expect(api.refresh).toHaveBeenCalledWith(expect.objectContaining({ browseId: 'VLcreated' }), [track], []);
});
