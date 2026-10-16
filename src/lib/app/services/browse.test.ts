import { beforeEach, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
const mocks = vi.hoisted(() => ({ playlist: vi.fn(), radio: vi.fn(), album: vi.fn(), tracks: vi.fn() }));
vi.mock('./player', () => ({ playTracks: mocks.tracks }));
vi.mock('./playlists', () => ({ openPlaylist: vi.fn(), playPlaylist: mocks.playlist }));
vi.mock('./catalog', () => ({ openAlbum: vi.fn(), openArtist: vi.fn() }));
vi.mock('./auth', () => ({ authStore: writable(null) }));
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({ getAlbumPage: mocks.album }));
vi.mock('./contextMenu', () => ({ notify: vi.fn() }));
vi.mock('./platform', () => ({ errorMessage: vi.fn() }));
vi.mock('./radio', () => ({ playRadio: mocks.radio }));
vi.mock('./navigation', () => ({ openPage: vi.fn() }));
import { playCarouselEntry } from './browse';
import type { HomeSection } from '$lib/infra/ytmusic/rawHome';
import type { CarouselEntry } from '$lib/ui/components/carouselTypes';
const section = { cards: [], songs: [], title: 'Home' } as HomeSection;
const entry = (browseId: string): CarouselEntry => ({ key: `c:${browseId}`, browseId, title: 'Selected', kind: 'card', thumbnails: [], playback: { playlistId: 'RDunrelated' } });
beforeEach(() => vi.clearAllMocks());
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
