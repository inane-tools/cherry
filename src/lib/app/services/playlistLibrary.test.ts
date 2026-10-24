import { beforeEach, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import type { AuthSession, Playlist } from '$lib/core/models';
const api = vi.hoisted(() => ({ channel: 'a', save: vi.fn(), unsave: vi.fn(), record: vi.fn(), remove: vi.fn(), prepend: vi.fn(), clear: vi.fn(), notify: vi.fn() }));
vi.mock('./auth', () => ({ authStore: writable<AuthSession | null>(null) }));
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({ getActiveChannel: () => api.channel, addPlaylistToLibrary: api.save, removePlaylistFromLibrary: api.unsave }));
vi.mock('./addablePlaylists', () => ({ addablePlaylistsStore: writable<Playlist[]>([]) }));
vi.mock('./playlists', () => ({ playlistStore: writable<Playlist[]>([]), recordLibraryPlaylist: api.record, recordLibraryRemoval: api.remove }));
vi.mock('./folders', () => ({ prependSidebarItem: api.prepend }));
vi.mock('./contextMenu', () => ({ notify: api.notify }));
vi.mock('$lib/infra/storage/cache', () => ({ cacheClear: api.clear }));
import { authStore } from './auth';
import { savePlaylist, unsavePlaylist } from './playlistLibrary';
const playlist: Playlist = { browseId: 'VLsaved', title: 'Saved', thumbnails: [] };
beforeEach(() => {
  vi.clearAllMocks(); api.channel = 'a';
  authStore.set({ kind: 'cookie', cookie: 'SID=test', savedAt: 0 });
  api.save.mockResolvedValue(undefined); api.unsave.mockResolvedValue(undefined);
});
it('does not save a late result into the next brand library or sidebar', async () => {
  let finish!: () => void;
  api.save.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const pending = savePlaylist(playlist); api.channel = 'b'; finish();
  expect(await pending).toBe(false);
  expect(api.record).not.toHaveBeenCalled(); expect(api.prepend).not.toHaveBeenCalled();
  expect(api.clear).toHaveBeenCalledWith('library:a:');
  expect(api.notify).not.toHaveBeenCalled();
});
it('does not remove a late result from the next brand library', async () => {
  let finish!: () => void;
  api.unsave.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const pending = unsavePlaylist(playlist); api.channel = 'b'; finish();
  expect(await pending).toBe(false);
  expect(api.remove).not.toHaveBeenCalled(); expect(api.clear).toHaveBeenCalledWith('library:a:');
});
