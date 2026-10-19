import type { SidebarPin } from '$lib/core/models';
import { sidebarPinPreview } from '$lib/core/sidebarItems';
import { openAlbum, openArtist } from './catalog';
import { openPlaylist } from './playlists';
import { playTracks } from './player';

export function openSidebarPin(pin: SidebarPin): void {
  if (pin.kind === 'album') openAlbum(pin.album);
  else if (pin.kind === 'artist') openArtist(pin.artist);
  else if (pin.kind === 'song') void playTracks([pin.track]);
  else openPlaylist(sidebarPinPreview(pin));
}
