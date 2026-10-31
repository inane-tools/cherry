import { expect, it, vi } from 'vitest';
import { openQueueSource } from './queueSourceNavigation';
import { openPlaylist } from './playlists';
import { openAlbum } from './catalog';

vi.mock('./playlists', () => ({ openPlaylist: vi.fn() }));
vi.mock('./catalog', () => ({ openAlbum: vi.fn() }));
vi.mock('./mixes', () => ({ openMix: vi.fn() }));

it('carries source artwork into playlist and album navigation', () => {
  const thumbnails = [{ url: 'https://image.test/source' }];
  openQueueSource({ kind: 'playlist', browseId: 'VLPLoutside-library', title: 'Playlist', thumbnails });
  expect(openPlaylist).toHaveBeenCalledWith({ browseId: 'VLPLoutside-library', title: 'Playlist', thumbnails });
  openQueueSource({ kind: 'album', browseId: 'MPRalbum', title: 'Album', thumbnails });
  expect(openAlbum).toHaveBeenCalledWith({ browseId: 'MPRalbum', title: 'Album', artists: [], thumbnails });
});

it('still opens queue sources saved before artwork was included', () => {
  openQueueSource({ kind: 'playlist', browseId: 'VLPLold', title: 'Old queue' });
  expect(openPlaylist).toHaveBeenCalledWith({ browseId: 'VLPLold', title: 'Old queue', thumbnails: [] });
});
