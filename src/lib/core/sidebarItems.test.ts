import { expect, it } from 'vitest';
import { buildSidebarItems, sidebarPinPreview } from './sidebarItems';
import type { SidebarPin } from './models';

const album: SidebarPin = { kind: 'album', browseId: 'MPRalbum', title: 'Album', album: { browseId: 'MPRalbum', title: 'Album', artists: [], thumbnails: [] } };
it('renders mixed pins in saved order even with no loaded library playlists', () => {
  const pins: SidebarPin[] = [album, { browseId: 'VLlegacy', title: 'Legacy playlist' }, { kind: 'artist', browseId: 'UCartist', title: 'Artist', artist: { browseId: 'UCartist', name: 'Artist' } }];
  expect(buildSidebarItems([], [], [], pins).map(item => [item.id, item.type])).toEqual([['MPRalbum', 'pin'], ['VLlegacy', 'playlist'], ['UCartist', 'pin']]);
  expect(sidebarPinPreview(album).author).toBe('Album');
});
it('keeps pins above folders, excludes duplicate library rows and preserves folder contents', () => {
  const playlist = { browseId: 'VLpinned', title: 'Current title', thumbnails: [] };
  const child = { browseId: 'VLchild', title: 'Child', thumbnails: [] };
  const folder = { id: 'folder', name: 'Folder', playlistIds: [playlist.browseId, child.browseId] };
  const result = buildSidebarItems(['folder', playlist.browseId], [playlist, child], [folder], [{ browseId: playlist.browseId, title: 'Old title' }, album]);
  expect(result.map(item => item.id)).toEqual(['VLpinned', 'MPRalbum', 'folder']);
  expect(result[0]).toMatchObject({ playlist: { title: 'Current title' } });
  expect(result[2]).toMatchObject({ items: [child] });
});

it('hides web-only playlists including pins and folder children without changing saved data', () => {
  const music = { browseId: 'music', title: 'Music', thumbnails: [], librarySource: 'music' as const };
  const youtube = { browseId: 'youtube', title: 'Videos', thumbnails: [], librarySource: 'youtube' as const };
  const unknown = { browseId: 'new', title: 'New playlist', thumbnails: [] };
  const folder = { id: 'folder', name: 'Folder', playlistIds: ['youtube', 'music'] };
  const playlists = [music, youtube, unknown];
  const pins = [{ browseId: 'youtube', title: 'Videos' }, album];
  const order = ['new', 'folder'];
  const hidden = buildSidebarItems(order, playlists, [folder], pins, false);
  expect(hidden.map(item => item.id)).toEqual(['MPRalbum', 'new', 'folder']);
  expect(hidden[2]).toMatchObject({ items: [music] });
  expect(buildSidebarItems(order, playlists, [folder], pins, true).map(item => item.id)).toEqual(['youtube', 'MPRalbum', 'new', 'folder']);
  expect(playlists).toHaveLength(3);
  expect(folder.playlistIds).toEqual(['youtube', 'music']);
  expect(pins).toHaveLength(2);
});
