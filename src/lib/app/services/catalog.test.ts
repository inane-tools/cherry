import { beforeEach, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';
import type { Page } from './navigation';
import type { AlbumPage, ArtistPage } from '$lib/infra/ytmusic/InnertubeClient';
vi.mock('./auth', () => ({ authStore: writable(null) }));
vi.mock('./navigation', () => ({ openPage: vi.fn(), pageStore: writable<Page>({ view: 'home' }) }));
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({ getArtistPage: vi.fn(), getAlbumPage: vi.fn(), getTrackAlbum: vi.fn() }));
vi.mock('./contextMenu', () => ({ notify: vi.fn() }));
import { pageStore, openPage } from './navigation';
import { getAlbumPage, getArtistPage, getTrackAlbum } from '$lib/infra/ytmusic/InnertubeClient';
import { loadAlbumPage, loadArtistPage, openTrackAlbum } from './catalog';
import { notify } from './contextMenu';
const artist = { name: 'Artist', browseId: 'UCartist' };
const details: ArtistPage = { title: 'Artist', thumbnails: [{ url: 'https://image.test/portrait' }], sections: [] };
beforeEach(() => { vi.clearAllMocks(); pageStore.set({ view: 'artist', entity: artist }); });

it('opens a known song album without a metadata request', async () => {
  await openTrackAlbum({ videoId: 'song', title: 'Song', artists: [artist], thumbnails: [], album: { name: 'Album', browseId: 'MPREalbum' } });
  expect(getTrackAlbum).not.toHaveBeenCalled();
  expect(openPage).toHaveBeenCalledWith({ view: 'album', entity: { title: 'Album', browseId: 'MPREalbum', artists: [], thumbnails: [] } });
});

it('updates the top bar from the album response instead of retaining the song artist', async () => {
  const album = { browseId: 'MPREalbum', title: 'Old title', artists: [artist], thumbnails: [] };
  pageStore.set({ view: 'album', entity: album });
  const albumDetails: AlbumPage = { title: 'Soundtrack', artists: [{ name: 'Various Artists' }],
    year: '2026', thumbnails: [{ url: 'https://image.test/album' }], tracks: [] };
  vi.mocked(getAlbumPage).mockResolvedValueOnce(albumDetails);
  await loadAlbumPage(album);
  expect(get(pageStore)).toEqual({ view: 'album', entity: { browseId: 'MPREalbum',
    title: 'Soundtrack', artists: albumDetails.artists, year: '2026', thumbnails: albumDetails.thumbnails } });
  expect(openPage).not.toHaveBeenCalled();
});

it('does not apply late album metadata after navigating to another album', async () => {
  const album = { browseId: 'MPREold', title: 'Old', artists: [], thumbnails: [] };
  let finish!: (details: AlbumPage) => void;
  vi.mocked(getAlbumPage).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const loading = loadAlbumPage(album);
  const other = { ...album, browseId: 'MPREother', title: 'Other' };
  pageStore.set({ view: 'album', entity: other });
  finish({ title: 'Old', artists: [artist], thumbnails: [], tracks: [] }); await loading;
  expect(get(pageStore)).toEqual({ view: 'album', entity: other });
});

it('resolves missing album metadata on demand and handles unavailable albums', async () => {
  const song = { videoId: 'song', title: 'Song', artists: [], thumbnails: [] };
  vi.mocked(getTrackAlbum).mockResolvedValueOnce({ name: 'Album', browseId: 'MPREalbum' });
  await openTrackAlbum(song);
  expect(getTrackAlbum).toHaveBeenCalledWith('song', null);
  expect(openPage).toHaveBeenCalledWith({ view: 'album', entity: { title: 'Album', browseId: 'MPREalbum', artists: [], thumbnails: [] } });
  vi.mocked(openPage).mockClear();
  vi.mocked(getTrackAlbum).mockResolvedValueOnce(undefined);
  await openTrackAlbum(song);
  expect(openPage).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith('No album available for this song');
});

it('passes the fetched artist portrait to the current navigation header without navigating', async () => {
  vi.mocked(getArtistPage).mockResolvedValueOnce(details);
  await loadArtistPage(artist);
  expect(get(pageStore)).toEqual({ view: 'artist', entity: { ...artist, thumbnails: details.thumbnails } });
});

it('does not put an old artist portrait into a different page', async () => {
  let finish!: (details: ArtistPage) => void;
  vi.mocked(getArtistPage).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const loading = loadArtistPage(artist);
  pageStore.set({ view: 'artist', entity: { name: 'Other', browseId: 'UCother' } });
  finish(details); await loading;
  expect(get(pageStore)).toEqual({ view: 'artist', entity: { name: 'Other', browseId: 'UCother' } });
});
