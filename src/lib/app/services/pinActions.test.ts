import { expect, it, vi } from 'vitest';
vi.mock('./catalog', () => ({ openAlbum: vi.fn(), openArtist: vi.fn() }));
vi.mock('./playlists', () => ({ openPlaylist: vi.fn() }));
vi.mock('./player', () => ({ playTracks: vi.fn() }));
import { openSidebarPin } from './pinActions';
import { openAlbum, openArtist } from './catalog';
import { openPlaylist } from './playlists';
import { playTracks } from './player';

it('opens albums/artists, plays songs and preserves the legacy playlist action', () => {
  const album = { browseId: 'MPRalbum', title: 'Album', artists: [], thumbnails: [] };
  const artist = { browseId: 'UCartist', name: 'Artist' };
  const track = { videoId: 'song', title: 'Song', artists: [], thumbnails: [] };
  openSidebarPin({ kind: 'album', browseId: album.browseId, title: album.title, album });
  openSidebarPin({ kind: 'artist', browseId: artist.browseId, title: artist.name, artist });
  openSidebarPin({ kind: 'song', browseId: 'song:song', title: track.title, track });
  expect(openAlbum).toHaveBeenCalledExactlyOnceWith(album);
  expect(openArtist).toHaveBeenCalledExactlyOnceWith(artist);
  expect(playTracks).toHaveBeenCalledExactlyOnceWith([track]);
  expect(openPlaylist).not.toHaveBeenCalled();
  openSidebarPin({ browseId: 'VLlegacy', title: 'Legacy' });
  expect(openPlaylist).toHaveBeenCalledExactlyOnceWith({ browseId: 'VLlegacy', title: 'Legacy', thumbnails: [] });
});
