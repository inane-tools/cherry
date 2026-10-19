import { isPlaylistPin, type Playlist, type PlaylistFolder, type SidebarPin } from './models';

export type SidebarItem = { id: string; type: 'playlist'; playlist: Playlist }
  | { id: string; type: 'pin'; pin: SidebarPin }
  | { id: string; type: 'folder'; folder: PlaylistFolder; items: Playlist[] };

export function sidebarPinPreview(pin: SidebarPin): Playlist {
  const fallback = pin.thumbnail ? [{ url: pin.thumbnail }] : [];
  if (pin.kind === 'album') return { browseId: pin.browseId, title: pin.title, author: ['Album', ...pin.album.artists.map(artist => artist.name)].join(' · '), thumbnails: pin.album.thumbnails.length ? pin.album.thumbnails : fallback };
  if (pin.kind === 'artist') return { browseId: pin.browseId, title: pin.title, author: 'Artist', thumbnails: pin.artist.thumbnails?.length ? pin.artist.thumbnails : fallback };
  if (pin.kind === 'song') return { browseId: pin.browseId, title: pin.title, author: ['Song', ...pin.track.artists.map(artist => artist.name)].join(' · '), thumbnails: pin.track.thumbnails.length ? pin.track.thumbnails : fallback };
  return { browseId: pin.browseId, title: pin.title, thumbnails: fallback };
}

export function buildSidebarItems(order: string[], playlists: Playlist[], folders: PlaylistFolder[], pins: SidebarPin[]): SidebarItem[] {
  const pinIds = new Set(pins.map(pin => pin.browseId));
  const assigned = new Set(folders.flatMap(folder => folder.playlistIds));
  const unpinned = playlists.filter(playlist => !pinIds.has(playlist.browseId) && !assigned.has(playlist.browseId));
  const rows = new Map<string, SidebarItem>([
    ...unpinned.map(playlist => [playlist.browseId, { id: playlist.browseId, type: 'playlist', playlist }] as const),
    ...folders.map(folder => [folder.id, { id: folder.id, type: 'folder', folder,
      items: folder.playlistIds.map(id => playlists.find(playlist => playlist.browseId === id)).filter((playlist): playlist is Playlist => !!playlist && !pinIds.has(playlist.browseId)) }] as const),
  ]);
  const result: SidebarItem[] = pins.map(pin => isPlaylistPin(pin)
    ? { id: pin.browseId, type: 'playlist', playlist: playlists.find(playlist => playlist.browseId === pin.browseId) ?? sidebarPinPreview(pin) }
    : { id: pin.browseId, type: 'pin', pin });
  for (const id of [...order, ...rows.keys()]) {
    const row = rows.get(id);
    if (row) { result.push(row); rows.delete(id); }
  }
  return result;
}
