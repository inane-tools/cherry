import { expect, it, vi } from 'vitest';
vi.mock('./player', () => ({ playTracks: vi.fn(async () => {}) }));
vi.mock('./playlists', () => ({ openPlaylist: vi.fn(), playPlaylist: vi.fn(async () => {}) }));
vi.mock('./catalog', () => ({ openAlbum: vi.fn(), openArtist: vi.fn() }));
vi.mock('./navigation', () => ({ openPage: vi.fn() }));
vi.mock('./auth', async () => ({ authStore: (await import('svelte/store')).writable(null) }));
vi.mock('./contextMenu', () => ({ notify: vi.fn() }));
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({ getAlbumPage: vi.fn(async () => ({ tracks: [{ videoId: 'album-song', title: 'Song', artists: [], thumbnails: [] }], artists: [{ name: 'Album artist' }] })) }));
import { entriesOf, selectCarouselEntry, playCarouselEntry } from './browse';
import { playPlaylist, openPlaylist } from './playlists';
import { playTracks } from './player';
import { openPage } from './navigation';
const section = { title: 'For you', cards: [{ browseId: 'VLplaylist', title: 'Playlist', thumbnails: [] }], songs: [{ videoId: 'song', title: 'Song', thumbnails: [] }], order: ['s:song', 'c:VLplaylist'] };

it('keeps server order and separates opening a playlist from playing it', async () => {
  vi.clearAllMocks();
  const entries = entriesOf(section);
  expect(entries.map((e) => e.key)).toEqual(section.order);
  await playCarouselEntry(section, entries[1]);
  expect(playPlaylist).toHaveBeenCalledOnce();
  expect(openPlaylist).not.toHaveBeenCalled();
  await selectCarouselEntry(section, entries[1]);
  expect(openPlaylist).toHaveBeenCalledOnce();
});

it('plays songs and albums directly and opens navigation buttons as browse pages', async () => {
  vi.clearAllMocks();
  await selectCarouselEntry(section, entriesOf(section)[0]);
  expect(playTracks).toHaveBeenCalledWith([expect.objectContaining({ videoId: 'song' })], 0);
  await playCarouselEntry(section, { key: 'c:MPRalbum', title: 'Album', thumbnails: [], kind: 'card' });
  expect(playTracks).toHaveBeenLastCalledWith([expect.objectContaining({ videoId: 'album-song', artists: [{ name: 'Album artist' }] })]);
  await selectCarouselEntry(section, { key: 'c:FEmusic_category', browseId: 'FEmusic_category', browseParams: 'focus', title: 'Focus', thumbnails: [], kind: 'card', canPlay: false });
  expect(openPage).toHaveBeenCalledWith({ view: 'browse', entity: { browseId: 'FEmusic_category', title: 'Focus', params: 'focus' } });
});
