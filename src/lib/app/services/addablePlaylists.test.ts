import { beforeEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { Playlist, AuthSession, AccountProfile } from '$lib/core/models';
const mocks = vi.hoisted(() => ({ channel: 'brand', getAddable: vi.fn() }));
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({ getActiveChannel: () => mocks.channel, getAddablePlaylists: mocks.getAddable }));
vi.mock('$lib/infra/storage/cache', () => ({ cacheClear: vi.fn() }));
vi.mock('./auth', async () => ({ authStore: (await import('svelte/store')).writable<AuthSession | null>(null) }));
vi.mock('./account', async () => ({ activeChannelStore: (await import('svelte/store')).writable<AccountProfile | null>(null) }));
vi.mock('./player', async () => ({ playerStore: (await import('svelte/store')).writable({ track: null }) }));
vi.mock('./playlists', async () => ({ playlistStore: (await import('svelte/store')).writable<Playlist[]>([]) }));
import { authStore } from './auth';
import { activeChannelStore } from './account';
import { cacheClear } from '$lib/infra/storage/cache';
import { addablePlaylistsStore, addablePlaylistsLoading, loadAddablePlaylists, addPlaylistLocally, renamePlaylistLocally, removePlaylistLocally, resetAddablePlaylists } from './addablePlaylists';
const session: AuthSession = { kind: 'cookie', cookie: 'SID=synthetic', savedAt: 0 };
const playlist = (id: string, title = id): Playlist => ({ browseId: id, title, thumbnails: [] });
function deferred() { let resolve!: (list: Playlist[]) => void; const promise = new Promise<Playlist[]>(done => { resolve = done; }); return { resolve, promise }; }
beforeEach(() => {
  authStore.set(null); resetAddablePlaylists(); mocks.channel = 'brand';
  mocks.getAddable.mockReset().mockResolvedValue([]); vi.mocked(cacheClear).mockClear();
  activeChannelStore.set({ pageId: 'brand', name: 'Brand' }); authStore.set(session);
});
it('keeps a successfully created playlist when an older menu response arrives', async () => {
  const old = deferred(); mocks.getAddable.mockReturnValueOnce(old.promise);
  const request = loadAddablePlaylists();
  addPlaylistLocally(playlist('VLNEW'));
  old.resolve([playlist('VLOLD')]); await request;
  expect(get(addablePlaylistsStore).map(p => p.browseId)).toEqual(['VLNEW', 'VLOLD']);
  expect(cacheClear).toHaveBeenCalledWith('addable:brand:');
});
it('preserves new playlists when the next menu is still delayed on the server', async () => {
  addPlaylistLocally(playlist('VLNEW'));
  await loadAddablePlaylists();
  expect(get(addablePlaylistsStore)).toEqual([playlist('VLNEW')]);
});
it('does not restore old titles or resurrect a deleted playlist from an in-flight response', async () => {
  addPlaylistLocally(playlist('VLKEEP', 'Old'));
  addPlaylistLocally(playlist('VLDELETE'));
  const old = deferred(); mocks.getAddable.mockReturnValueOnce(old.promise);
  const request = loadAddablePlaylists();
  renamePlaylistLocally('VLKEEP', 'New'); removePlaylistLocally('VLDELETE');
  old.resolve([playlist('VLKEEP', 'Old'), playlist('VLDELETE')]); await request;
  expect(get(addablePlaylistsStore)).toEqual([playlist('VLKEEP', 'New')]);
});
it('isolates account slots and ignores stale completion without clearing a newer spinner', async () => {
  const old = deferred(), fresh = deferred();
  mocks.getAddable.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const first = loadAddablePlaylists(); addPlaylistLocally(playlist('VLACCOUNT0'));
  authStore.set({ ...session, accountIndex: 1 });
  const second = loadAddablePlaylists();
  old.resolve([playlist('VLACCOUNT0')]); await first;
  expect(get(addablePlaylistsStore)).toEqual([]); expect(get(addablePlaylistsLoading)).toBe(true);
  fresh.resolve([playlist('VLACCOUNT1')]); await second;
  expect(get(addablePlaylistsStore)).toEqual([playlist('VLACCOUNT1')]); expect(get(addablePlaylistsLoading)).toBe(false);
});
it('does not retain local ownership after changing brand channels', async () => {
  addPlaylistLocally(playlist('VLBRAND'));
  mocks.channel = 'other'; activeChannelStore.set({ pageId: 'other', name: 'Other' });
  await loadAddablePlaylists(); expect(get(addablePlaylistsStore)).toEqual([]);
});
