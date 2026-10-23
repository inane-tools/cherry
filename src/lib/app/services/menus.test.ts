import { expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
const mocks = vi.hoisted(() => ({ tracks: vi.fn(), collection: vi.fn(), owned: vi.fn(() => false), copy: vi.fn(async () => true) }));
vi.mock('./links', async importOriginal => ({ ...await importOriginal<typeof import('./links')>(), copyText: mocks.copy }));
vi.mock('./radio', () => ({ playRadio: vi.fn() }));
vi.mock('./player', () => ({ playTracks: vi.fn() }));
vi.mock('./playlists', () => ({ playPlaylist: vi.fn() }));
vi.mock('./catalog', () => ({ openArtist: vi.fn(), openTrackAlbum: vi.fn() }));
vi.mock('./pins', () => ({ isPinned: () => false, togglePin: vi.fn(), toggleAlbumPin: vi.fn(), toggleArtistPin: vi.fn(), toggleTrackPin: vi.fn() }));
vi.mock('./auth', () => ({ authStore: writable({ kind: 'cookie', cookie: 'SID=fixture', savedAt: 0 }) }));
vi.mock('./playlistEdit', () => ({ getDefaultPlaylist: () => null, removeTrackFrom: vi.fn(), saveTrack: vi.fn(), setDefaultPlaylist: vi.fn() }));
vi.mock('./playlistLibrary', () => ({ isPlaylistOwned: mocks.owned, isPlaylistSaved: () => false, ownershipKnown: () => false, savePlaylist: vi.fn(), unsavePlaylist: vi.fn() }));
vi.mock('./playlistDelete', () => ({ requestPlaylistDeletion: vi.fn() }));
vi.mock('./folders', () => ({ foldersStore: writable([]), folderFor: () => null, movePlaylistToFolder: vi.fn(), deleteFolder: vi.fn() }));
vi.mock('./folderDialog', () => ({ openFolderDialog: vi.fn() }));
vi.mock('./playlistEditor', () => ({ openPlaylistEditor: vi.fn() }));
vi.mock('./playlistPicker', () => ({ openPlaylistPicker: vi.fn() }));
vi.mock('./songCredits', () => ({ openSongCredits: vi.fn() }));
vi.mock('./queueActions', () => ({ queueTracks: mocks.tracks, queueCollection: mocks.collection }));
import { trackMenu, playlistMenu, albumMenu, folderMenu, artistMenu, stationMenu } from './menus';
import { toggleAlbumPin, toggleArtistPin, toggleTrackPin } from './pins';
import { openArtist, openTrackAlbum } from './catalog';

it('offers album navigation for songs, including rows whose album needs resolving', async () => {
  const song = { videoId: 'song', title: 'Song', artists: [], thumbnails: [] };
  const action = trackMenu(song).find(item => item.label === 'Go to album')!;
  expect(action.icon).toBe('ph ph-vinyl-record');
  await action.action();
  expect(openTrackAlbum).toHaveBeenCalledWith(song);
});

it('offers pinning from album, artist and song context menus', async () => {
  const album = { browseId: 'MPRalbum', title: 'Album', artists: [], thumbnails: [] };
  const artist = { browseId: 'UCartist', name: 'Artist' };
  const track = { videoId: 'song', title: 'Song', artists: [], thumbnails: [] };
  await albumMenu(album).find(item => item.label === 'Pin album')!.action();
  await artistMenu(artist).find(item => item.label === 'Pin artist')!.action();
  await trackMenu(track).find(item => item.label === 'Pin song')!.action();
  expect(toggleAlbumPin).toHaveBeenCalledWith(album);
  expect(toggleArtistPin).toHaveBeenCalledWith(artist);
  expect(toggleTrackPin).toHaveBeenCalledWith(track);
});
import { playRadio } from './radio';
import { removeTrackFrom } from './playlistEdit';

it('offers removal only for an editable playlist and passes the selected occurrence', async () => {
  const song = { videoId: 'same', title: 'Song', artists: [], thumbnails: [] };
  const playlist = { browseId: 'VLowned', title: 'Owned', thumbnails: [] };
  expect(trackMenu(song, [song, song], 1, playlist).some(item => item.label === 'Remove from this playlist')).toBe(false);
  mocks.owned.mockReturnValueOnce(true);
  const removal = trackMenu(song, [song, song], 1, playlist).find(item => item.label === 'Remove from this playlist')!;
  expect(removal.destructive).toBe(true);
  await removal.action();
  expect(removeTrackFrom).toHaveBeenCalledExactlyOnceWith(playlist, song, 1);
});

it('queues only the right-clicked song, not the rest of its surrounding list', async () => {
  const song = { videoId: 'song', title: 'Song', artists: [], thumbnails: [] };
  const other = { ...song, videoId: 'other' };
  const item = trackMenu(song, [other, song], 1).find(item => item.label === 'Add to queue')!;
  expect(item.disabled).toBe(false);
  await item.action();
  expect(mocks.tracks).toHaveBeenCalledExactlyOnceWith([song]);
});

it('offers queue actions for playlists/albums and Phosphor icons throughout the shared menus', async () => {
  const playlist = { browseId: 'VLplaylist', title: 'Playlist', thumbnails: [] };
  const album = { ...playlist, browseId: 'MPREalbum', artists: [] };
  for (const [menu, collection] of [[playlistMenu(playlist), playlist], [albumMenu(album), album]] as const) {
    const action = menu.find(item => item.label === 'Add to queue')!;
    expect(action.disabled).toBe(false);
    await action.action();
    expect(mocks.collection).toHaveBeenLastCalledWith(collection);
  }
  const song = { videoId: 'song', title: 'Song', artists: [], thumbnails: [] };
  const menus = [trackMenu(song), playlistMenu(playlist), albumMenu(album), folderMenu({ id: 'folder', name: 'Folder', playlistIds: [] })];
  for (const menu of menus) for (const item of menu) {
    if (item.brandIcon) expect(item.brandIcon).toBe('youtube-music');
    else expect(item.icon).toMatch(/^ph(?:-fill|-duotone)? ph-/);
  }
});

it('opens artists and plays stations from their exact endpoints without exposing playlist editing', async () => {
  const artist = { name: 'Artist', browseId: 'UCartist' };
  const artists = artistMenu(artist);
  await artists[0].action();
  expect(openArtist).toHaveBeenCalledWith(artist);
  const endpoint = { videoId: 'seed', playlistId: 'RDmix', params: 'server-params' };
  const station = stationMenu(endpoint);
  await station[0].action();
  expect(playRadio).toHaveBeenCalledWith(endpoint);
  expect(station.map(item => item.label)).toEqual(['Start mix', 'Copy music link', 'Copy video link']);
  for (const item of [...artists, ...station]) {
    if (item.brandIcon) expect(item.brandIcon).toBe('youtube-music');
    else expect(item.icon).toMatch(/^ph(?:-fill|-duotone)? ph-/);
  }
});

it('marks common shortcuts and uses the music brand and list-plus icons for their actions', () => {
  const menu = trackMenu({ videoId: 'song', title: 'Song', artists: [], thumbnails: [] });
  expect(menu.filter(item => item.quick).map(item => item.label)).toEqual(['Play', 'Add to queue', 'Pin song', 'Add to playlist…']);
  expect(menu.find(item => item.label === 'Add to playlist…')?.icon).toBe('ph ph-playlist');
  expect(menu.find(item => item.label === 'Add to queue')?.icon).toBe('ph ph-list-plus');
  expect(menu.find(item => item.label === 'Copy music link')?.brandIcon).toBe('youtube-music');
  expect(menu.find(item => item.label === 'Copy video link')?.icon).toBe('ph-fill ph-youtube-logo');
});

it('copies album and artist music links from their browse IDs', async () => {
  const album = { browseId: 'MPREalbum', title: 'Album', artists: [], thumbnails: [] };
  await albumMenu(album).find(item => item.label === 'Copy music link')!.action();
  expect(mocks.copy).toHaveBeenLastCalledWith('https://music.youtube.com/browse/MPREalbum');
  await artistMenu({ name: 'Artist', browseId: 'UCartist' }).find(item => item.label === 'Copy music link')!.action();
  expect(mocks.copy).toHaveBeenLastCalledWith('https://music.youtube.com/channel/UCartist');
  await artistMenu({ name: 'Artist', browseId: 'MPLAartist' }).find(item => item.label === 'Copy music link')!.action();
  expect(mocks.copy).toHaveBeenLastCalledWith('https://music.youtube.com/browse/MPLAartist');
});
