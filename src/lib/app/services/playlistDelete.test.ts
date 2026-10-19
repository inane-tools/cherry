import { beforeEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
const playlist = { browseId: 'VLPL123', title: 'My playlist', thumbnails: [] };
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({ deleteOwnedPlaylist: vi.fn(async () => {}), getActiveChannel: vi.fn(() => 'channel') }));
vi.mock('./auth', async () => ({ authStore: (await import('svelte/store')).writable({ kind: 'cookie', cookie: 'session', savedAt: 0 }) }));
vi.mock('./addablePlaylists', async () => {
  const addablePlaylistsStore = (await import('svelte/store')).writable<import('$lib/core/models').Playlist[]>([]);
  return { addablePlaylistsStore, removePlaylistLocally: (id: string) => addablePlaylistsStore.update(list => list.filter(p => p.browseId !== id)) };
});
vi.mock('./playlists', async () => ({ playlistStore: (await import('svelte/store')).writable([]), homeSectionsStore: (await import('svelte/store')).writable([]) }));
vi.mock('./pins', async () => ({ removePin: async () => {
  const { updateSettings } = await import('./settings');
  await updateSettings({ pinnedPlaylists: [] });
} }));
vi.mock('./playlistLibrary', () => ({ isPlaylistOwned: vi.fn(() => true) }));
vi.mock('./folders', () => ({ initFolders: vi.fn() }));
vi.mock('./navigation', () => ({ forgetPlaylistPage: vi.fn() }));
vi.mock('./contextMenu', () => ({ notify: vi.fn() }));
vi.mock('./platform', () => ({ errorMessage: (error: Error) => error.message }));
vi.mock('./settings', async () => {
  const { writable, get } = await import('svelte/store');
  const settingsStore = writable({});
  return { settingsStore, updateSettings: async (patch: object) => settingsStore.set({ ...get(settingsStore), ...patch }) };
});
import { requestPlaylistDeletion, confirmPlaylistDeletion, cancelPlaylistDeletion, playlistDeleteStore } from './playlistDelete';
import { deleteOwnedPlaylist, getActiveChannel } from '$lib/infra/ytmusic/InnertubeClient';
import { isPlaylistOwned } from './playlistLibrary';
import { playlistStore } from './playlists';
import { settingsStore } from './settings';
import { addablePlaylistsStore } from './addablePlaylists';
import { forgetPlaylistPage } from './navigation';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(deleteOwnedPlaylist).mockResolvedValue(undefined);
  vi.mocked(isPlaylistOwned).mockReturnValue(true);
  vi.mocked(getActiveChannel).mockReturnValue('channel');
  playlistDeleteStore.set({ playlist: null, busy: false, error: '' });
  playlistStore.set([playlist]);
  addablePlaylistsStore.set([playlist]);
  settingsStore.set({ ...get(settingsStore), pinnedPlaylists: [{ ...playlist, thumbnail: '' }], recentPlaylists: [{ ...playlist, thumbnail: '' }], playlistFolders: [{ id: 'folder', name: 'Folder', playlistIds: [playlist.browseId] }], sidebarOrder: [playlist.browseId], defaultPlaylistBrowseId: playlist.browseId });
});

it('requires explicit confirmation and clears deleted playlist references after success', async () => {
  requestPlaylistDeletion(playlist);
  expect(deleteOwnedPlaylist).not.toHaveBeenCalled();
  expect(await confirmPlaylistDeletion()).toBe(true);
  expect(deleteOwnedPlaylist).toHaveBeenCalledOnce();
  expect(get(playlistStore)).toEqual([]);
  expect(get(addablePlaylistsStore)).toEqual([]);
  expect(get(settingsStore)).toMatchObject({ pinnedPlaylists: [], recentPlaylists: [], sidebarOrder: [], defaultPlaylistBrowseId: '' });
  expect(get(settingsStore).playlistFolders[0].playlistIds).toEqual([]);
  expect(forgetPlaylistPage).toHaveBeenCalledWith(playlist.browseId);
});

it('keeps the playlist and shows an error if the server rejects deletion', async () => {
  vi.mocked(deleteOwnedPlaylist).mockRejectedValue(new Error('Permission denied'));
  requestPlaylistDeletion(playlist);
  expect(await confirmPlaylistDeletion()).toBe(false);
  expect(get(playlistStore)).toEqual([playlist]);
  expect(get(playlistDeleteStore)).toMatchObject({ playlist, busy: false, error: 'Permission denied' });
});

it('does not delete after cancellation or for an unowned playlist', async () => {
  requestPlaylistDeletion(playlist);
  cancelPlaylistDeletion();
  expect(await confirmPlaylistDeletion()).toBe(false);
  vi.mocked(isPlaylistOwned).mockReturnValue(false);
  requestPlaylistDeletion(playlist);
  expect(get(playlistDeleteStore).playlist).toBeNull();
  expect(deleteOwnedPlaylist).not.toHaveBeenCalled();
});

it('refuses to confirm after switching channels', async () => {
  requestPlaylistDeletion(playlist);
  vi.mocked(getActiveChannel).mockReturnValue('other-channel');
  expect(await confirmPlaylistDeletion()).toBe(false);
  expect(deleteOwnedPlaylist).not.toHaveBeenCalled();
});
