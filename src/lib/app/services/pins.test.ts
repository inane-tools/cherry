import { beforeEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
vi.mock('./settings', async () => {
  const { writable, get } = await import('svelte/store');
  const settingsStore = writable({ pinnedPlaylists: [], playlistFolders: [], sidebarOrder: [], collapsedFolders: [] });
  return { settingsStore, updateSettings: vi.fn(async (patch: object) => settingsStore.set({ ...get(settingsStore), ...patch })) };
});
vi.mock('./playlists', async () => ({ playlistStore: (await import('svelte/store')).writable([]) }));
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({ getActiveChannel: vi.fn(() => '') }));
import { settingsStore, updateSettings } from './settings';
import { initPins, pinnedStore, reorderPin, syncPins, toggleAlbumPin, toggleArtistPin, toggleTrackPin, togglePin, removePin } from './pins';
import { getActiveChannel } from '$lib/infra/ytmusic/InnertubeClient';
import { activeChannelStore } from './channelProfile';
import { initFolders, createFolder, movePlaylist, foldersStore } from './folders';
const pins = ['A', 'B', 'C'].map((browseId) => ({ browseId, title: browseId }));
function switchChannel(pageId: string) {
  settingsStore.update(s => ({ ...s, channelPageId: pageId }));
  activeChannelStore.set({ name: pageId || 'Personal', pageId });
}
beforeEach(() => {
  vi.mocked(getActiveChannel).mockReturnValue('');
  settingsStore.set({ ...get(settingsStore), channelPageId: '', pinnedPlaylistsByChannel: {}, pinnedPlaylists: pins, playlistFolders: [], sidebarOrder: [], collapsedFolders: [] });
  activeChannelStore.set({ name: 'Personal', pageId: '' });
  initPins();
  initFolders();
});

it('reorders pins within their group and persists the order without unpinning', async () => {
  await reorderPin('C', 'A');
  expect(get(pinnedStore).map((pin) => pin.browseId)).toEqual(['C', 'A', 'B']);
  expect(get(settingsStore).pinnedPlaylists).toEqual(get(pinnedStore));
  await reorderPin('C', 'not-a-pin');
  expect(get(pinnedStore).map((pin) => pin.browseId)).toEqual(['C', 'A', 'B']);
  await reorderPin('C', null);
  expect(get(pinnedStore).map((pin) => pin.browseId)).toEqual(['A', 'B', 'C']);
});

it('rejects folder moves for pins while allowing unpinned playlists', async () => {
  const folder = (await createFolder('Folder'))!;
  await movePlaylist('A', folder, null);
  expect(get(foldersStore)[0].playlistIds).toEqual([]);
  expect(get(pinnedStore)).toEqual(pins);
  await movePlaylist('unpinned', folder, null);
  expect(get(foldersStore)[0].playlistIds).toEqual(['unpinned']);
});

it('persists albums, artists and songs alongside legacy pins and restores their exact targets', async () => {
  const album = { browseId: 'MPRalbum', title: 'Album', artists: [{ name: 'Artist' }], thumbnails: [{ url: 'https://image.test/album' }] };
  const artist = { browseId: 'UCartist', name: 'Artist', thumbnails: [{ url: 'https://image.test/artist' }] };
  const track = { videoId: 'UCartist', title: 'Song', artists: [artist], thumbnails: [], playlistEntryId: 'source-entry' };
  await toggleAlbumPin(album); await toggleArtistPin(artist); await toggleTrackPin(track);
  expect(get(pinnedStore).map(pin => pin.browseId)).toEqual(['A', 'B', 'C', 'MPRalbum', 'UCartist', 'song:UCartist']);
  expect(get(pinnedStore)[5]).toMatchObject({ kind: 'song', track: { videoId: 'UCartist' } });
  expect(get(pinnedStore)[5]).not.toHaveProperty('track.playlistEntryId');
  pinnedStore.set([]); initPins();
  expect(get(pinnedStore)[3]).toMatchObject({ kind: 'album', album });
  await reorderPin('song:UCartist', 'A');
  expect(get(settingsStore).pinnedPlaylists[0].kind).toBe('song');
  await toggleArtistPin(artist);
  expect(get(pinnedStore).some(pin => pin.browseId === 'UCartist')).toBe(false);
  expect(get(pinnedStore).some(pin => pin.browseId === 'song:UCartist')).toBe(true);
  await syncPins([{ browseId: 'MPRalbum', title: 'Not a playlist', thumbnails: [] }]);
  expect(get(pinnedStore).find(pin => pin.browseId === 'MPRalbum')?.title).toBe('Album');
});

it('isolates shared playlist ids and pin order between channels, including after restart', async () => {
  const shared = { browseId: 'shared', title: 'Shared', thumbnails: [] };
  await togglePin(shared);
  switchChannel('brand-b');
  expect(get(pinnedStore)).toEqual([]);
  await togglePin(shared);
  await toggleTrackPin({ videoId: 'song-b', title: 'B song', artists: [], thumbnails: [] });
  await reorderPin('song:song-b', 'shared');
  switchChannel('');
  expect(get(pinnedStore).map(p => p.browseId)).toEqual(['A', 'B', 'C', 'shared']);
  await removePin('shared');
  initPins();
  switchChannel('brand-b');
  expect(get(pinnedStore).map(p => p.browseId)).toEqual(['song:song-b', 'shared']);
  await togglePin(shared);
  expect(get(pinnedStore).map(p => p.browseId)).toEqual(['song:song-b']);
  switchChannel('');
  expect(get(pinnedStore)).toEqual(pins);
});

it('does not lose pins when switching channels while a settings write is pending', async () => {
  await togglePin({ browseId: 'initial', title: 'Initial', thumbnails: [] });
  let release!: () => void;
  const gate = new Promise<void>(resolve => release = resolve);
  vi.mocked(updateSettings).mockImplementationOnce(async patch => {
    await gate;
    settingsStore.update(settings => ({ ...settings, ...patch }));
  });
  const first = togglePin({ browseId: 'pending-a', title: 'A', thumbnails: [] });
  await Promise.resolve();
  switchChannel('brand-b');
  const second = togglePin({ browseId: 'pending-b', title: 'B', thumbnails: [] });
  release(); await Promise.all([first, second]);
  expect(get(pinnedStore).map(p => p.browseId)).toEqual(['pending-b']);
  initPins();
  expect(get(pinnedStore).map(p => p.browseId)).toEqual(['pending-b']);
  switchChannel('');
  expect(get(pinnedStore).map(p => p.browseId)).toEqual(['A', 'B', 'C', 'initial', 'pending-a']);
});

it('does not refresh another channel’s pin metadata from an old library', async () => {
  await togglePin({ browseId: 'shared', title: 'Original', thumbnails: [] });
  switchChannel('brand-b');
  await togglePin({ browseId: 'shared', title: 'B title', thumbnails: [] });
  await syncPins([{ browseId: 'shared', title: 'Stale A title', thumbnails: [] }]);
  expect(get(pinnedStore)[0].title).toBe('B title');
  vi.mocked(getActiveChannel).mockReturnValue('brand-b');
  await syncPins([{ browseId: 'shared', title: 'Fresh B title', thumbnails: [] }]);
  expect(get(pinnedStore)[0].title).toBe('Fresh B title');
});

it('follows the applied account, not a pending channel preference, and clears on sign-out', async () => {
  await togglePin({ browseId: 'saved', title: 'Saved', thumbnails: [] });
  settingsStore.update(s => ({ ...s, channelPageId: 'brand-b' }));
  expect(get(pinnedStore).some(pin => pin.browseId === 'saved')).toBe(true);
  activeChannelStore.set({ name: 'B', pageId: 'brand-b' });
  expect(get(pinnedStore)).toEqual([]);
  await togglePin({ browseId: 'b', title: 'B', thumbnails: [] });
  activeChannelStore.set(null);
  expect(get(pinnedStore)).toEqual([]);
  switchChannel('');
  expect(get(pinnedStore).some(pin => pin.browseId === 'saved')).toBe(true);
});
