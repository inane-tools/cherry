import { beforeEach, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
const mocks = vi.hoisted(() => ({ playlist: vi.fn(), radio: vi.fn(), album: vi.fn(), tracks: vi.fn() }));
vi.mock('./player', () => ({ playTracks: mocks.tracks }));
vi.mock('./playlists', () => ({ openPlaylist: vi.fn(), playPlaylist: mocks.playlist }));
vi.mock('./catalog', () => ({ openAlbum: vi.fn(), openArtist: vi.fn() }));
vi.mock('./auth', () => ({ authStore: writable(null) }));
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({ getAlbumPage: mocks.album }));
vi.mock('./contextMenu', () => ({ notify: vi.fn(), openContextMenu: vi.fn() }));
vi.mock('./menus', () => ({
  trackMenu: vi.fn(() => [{ label: 'Song menu' }]), playlistMenu: vi.fn(() => [{ label: 'Playlist menu' }]),
  albumMenu: vi.fn(() => [{ label: 'Album menu' }]), artistMenu: vi.fn(() => [{ label: 'Artist menu' }]),
  stationMenu: vi.fn(() => [{ label: 'Station menu' }]),
}));
vi.mock('./platform', () => ({ errorMessage: vi.fn() }));
vi.mock('./radio', () => ({ playRadio: mocks.radio }));
vi.mock('./navigation', () => ({ openPage: vi.fn() }));
import { playCarouselEntry } from './browse';
import type { HomeSection } from '$lib/infra/ytmusic/rawHome';
import type { CarouselEntry } from '$lib/ui/components/carouselTypes';
const section = { cards: [], songs: [], title: 'Home' } as HomeSection;
const entry = (browseId: string): CarouselEntry => ({ key: `c:${browseId}`, browseId, title: 'Selected', kind: 'card', thumbnails: [], playback: { playlistId: 'RDunrelated' } });
beforeEach(() => vi.clearAllMocks());
it('retains artist artwork when opening a Home card', async () => {
  const { openBrowseCard } = await import('./browse');
  const { openArtist } = await import('./catalog');
  const thumbnails = [{ url: 'https://image.test/artist' }];
  openBrowseCard('UCartist', 'Artist', thumbnails, undefined, undefined, 'MUSIC_PAGE_TYPE_ARTIST');
  expect(openArtist).toHaveBeenCalledExactlyOnceWith({ name: 'Artist', browseId: 'UCartist', thumbnails });
});
it('plays the displayed playlist rather than its recommendation overlay endpoint', async () => {
  await playCarouselEntry(section, entry('VLPLselected'));
  expect(mocks.playlist).toHaveBeenCalledWith(expect.objectContaining({ browseId: 'VLPLselected' }));
  expect(mocks.radio).not.toHaveBeenCalled();
});
it('keeps station playback endpoints', async () => {
  await playCarouselEntry(section, entry('VLRDstation'));
  expect(mocks.radio).toHaveBeenCalledWith({ playlistId: 'RDunrelated' });
  expect(mocks.playlist).not.toHaveBeenCalled();
});
it('loads the displayed album instead of an overlay mix', async () => {
  mocks.album.mockResolvedValue({ tracks: [{ videoId: 'song', artists: [] }], artists: [] });
  await playCarouselEntry(section, entry('MPRalbum'));
  expect(mocks.album).toHaveBeenCalledWith('MPRalbum', null);
  expect(mocks.tracks).toHaveBeenCalled();
  expect(mocks.radio).not.toHaveBeenCalled();
});

import { entriesOf, selectCarouselEntry } from './browse';
import { playPlaylist, openPlaylist } from './playlists';
import { playTracks } from './player';
import { openPage } from './navigation';
import { openCarouselMenu } from './browse';
import { openContextMenu } from './contextMenu';
import { trackMenu, stationMenu } from './menus';
const originalSection = { title: 'For you', cards: [{ browseId: 'VLplaylist', title: 'Playlist', thumbnails: [] }], songs: [{ videoId: 'song', title: 'Song', thumbnails: [] }], order: ['s:song', 'c:VLplaylist'] };
it('keeps server order and separates opening a playlist from playing it', async () => {
  vi.clearAllMocks();
  const entries = entriesOf(originalSection);
  expect(entries.map((e) => e.key)).toEqual(originalSection.order);
  await playCarouselEntry(originalSection, entries[1]);
  expect(playPlaylist).toHaveBeenCalledOnce();
  expect(openPlaylist).not.toHaveBeenCalled();
  await selectCarouselEntry(originalSection, entries[1]);
  expect(openPlaylist).toHaveBeenCalledOnce();
});

it('plays songs and albums directly and opens navigation buttons as browse pages', async () => {
  vi.clearAllMocks();
  mocks.album.mockResolvedValue({ tracks: [{ videoId: 'album-song', title: 'Song', artists: [], thumbnails: [] }], artists: [{ name: 'Album artist' }] });
  await selectCarouselEntry(originalSection, entriesOf(originalSection)[0]);
  expect(playTracks).toHaveBeenCalledWith([expect.objectContaining({ videoId: 'song' })], 0);
  await playCarouselEntry(originalSection, { key: 'c:MPRalbum', title: 'Album', thumbnails: [], kind: 'card' });
  expect(playTracks).toHaveBeenLastCalledWith([expect.objectContaining({ videoId: 'album-song', artists: [{ name: 'Album artist' }] })]);
  await selectCarouselEntry(originalSection, { key: 'c:FEmusic_category', browseId: 'FEmusic_category', browseParams: 'focus', title: 'Focus', thumbnails: [], kind: 'card', canPlay: false });
  expect(openPage).toHaveBeenCalledWith({ view: 'browse', entity: { browseId: 'FEmusic_category', title: 'Focus', params: 'focus' } });
});

it.each([
  ['UCartist', undefined, 'Artist menu'],
  ['FEmusic_library_privately_owned_artist:artist', undefined, 'Artist menu'],
  ['different-artist-id', 'MUSIC_PAGE_TYPE_ARTIST', 'Artist menu'],
  ['VLplaylist', undefined, 'Playlist menu'],
  ['OLAKalbum-playlist', undefined, 'Playlist menu'],
  ['different-playlist-id', 'MUSIC_PAGE_TYPE_PLAYLIST', 'Playlist menu'],
  ['MPRalbum', undefined, 'Album menu'],
  ['different-album-id', 'MUSIC_PAGE_TYPE_ALBUM', 'Album menu'],
  ['VLRDmix', undefined, 'Station menu'],
  ['RDmix', undefined, 'Station menu'],
  ['station:mix', undefined, 'Station menu'],
])('opens the appropriate context menu for %s', async (browseId, pageType, label) => {
  const event = new MouseEvent('contextmenu', { cancelable: true });
  await openCarouselMenu(section, { ...entry(browseId), pageType }, event);
  expect(event.defaultPrevented).toBe(true);
  expect(openContextMenu).toHaveBeenCalledWith(event, [{ label }]);
  expect(mocks.playlist).not.toHaveBeenCalled();
  expect(mocks.radio).not.toHaveBeenCalled();
});

it('preserves station playback parameters and derives endpoints for mix-only cards', async () => {
  const event = new MouseEvent('contextmenu');
  const mix = entry('VLRDmix');
  await openCarouselMenu(section, mix, event);
  expect(stationMenu).toHaveBeenLastCalledWith(mix.playback);
  await openCarouselMenu(section, { ...mix, playback: undefined }, event);
  expect(stationMenu).toHaveBeenLastCalledWith({ playlistId: 'RDmix' });
});

it('keeps song/video metadata and row context for song menus', async () => {
  const songs = { ...originalSection, songs: [{ videoId: 'song', title: 'Song', thumbnails: [], isMusicVideo: true }] };
  const song = entriesOf(songs).find(item => item.kind === 'song')!;
  await openCarouselMenu(songs, song, new MouseEvent('contextmenu'));
  expect(trackMenu).toHaveBeenCalledWith(expect.objectContaining({ videoId: 'song', isMusicVideo: true }), expect.any(Array), 0);
});

it('provides an Open menu for navigation buttons without offering playback actions', async () => {
  const nav = { ...entry('FEmusic_category'), playback: undefined, browseParams: 'focus' };
  await openCarouselMenu(section, nav, new MouseEvent('contextmenu'));
  const items = vi.mocked(openContextMenu).mock.calls[0][1];
  expect(items.map(item => item.label)).toEqual(['Open']);
  await items[0].action();
  expect(openPage).toHaveBeenCalledWith({ view: 'browse', entity: { browseId: 'FEmusic_category', title: 'Selected', params: 'focus' } });
});

it('retains server page types for menu routing', () => {
  const entries = entriesOf({ ...section, cards: [{ browseId: 'unusual-id', title: 'Artist', thumbnails: [], pageType: 'MUSIC_PAGE_TYPE_ARTIST' }] });
  expect(entries[0].pageType).toBe('MUSIC_PAGE_TYPE_ARTIST');
});

it('opens user-channel cards as profiles without autoplay or artist navigation', async () => {
  const [profile] = entriesOf({ ...section, cards: [{ browseId: 'UCprofile', title: 'SAME', thumbnails: [], params: 'private-sections', pageType: 'MUSIC_PAGE_TYPE_USER_CHANNEL' }] });
  expect(profile).toMatchObject({ canPlay: false, round: true });
  await selectCarouselEntry(section, profile);
  expect(openPage).toHaveBeenCalledWith({ view: 'browse', entity: { browseId: 'UCprofile', title: 'SAME', params: 'private-sections', kind: 'profile', thumbnails: [] } });
  expect(mocks.radio).not.toHaveBeenCalled();
  expect(mocks.playlist).not.toHaveBeenCalled();
  await openCarouselMenu(section, profile, new MouseEvent('contextmenu'));
  const items = vi.mocked(openContextMenu).mock.calls[0][1];
  expect(items.map(item => item.label)).toEqual(['Open profile']);
  await items[0].action();
  expect(openPage).toHaveBeenCalledTimes(2);
});
