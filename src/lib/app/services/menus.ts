// Shared context-menu item builders, so every surface (track rows, playlist
// cards, the rail) offers the same actions.

import type { Playlist, Track } from '$lib/core/models';
import { get } from 'svelte/store';
import { playTracks } from './player';
import { playPlaylist } from './playlists';
import { isPinned, togglePin } from './pins';
import {
  copyText,
  musicUrlForPlaylist,
  musicUrlForTrack,
  playlistYouTubeUrl,
  trackYouTubeUrl,
} from './links';
import { notify, type ContextMenuItem } from './contextMenu';
import { authStore } from './auth';
import { announceSignInRequired } from './gate';

async function copy(label: string, url: string): Promise<void> {
  const ok = await copyText(url);
  notify(ok ? `${label} copied` : 'Could not copy to the clipboard');
}

/** Menu for a single track. `list`/`index` let "Play" use the row's context. */
export function trackMenu(track: Track, list?: Track[], index = 0): ContextMenuItem[] {
  const canPlay = !!(get(authStore) && track.videoId);
  return [
    {
      label: 'Play',
      icon: 'bx bx-play',
      disabled: !canPlay,
      action: () => {
        if (!get(authStore)) return announceSignInRequired();
        const queue = list && list.length > 0 ? list : [track];
        const at = list && list.length > 0 ? index : 0;
        void playTracks(queue, at);
      },
    },
    {
      label: 'Copy link (YouTube Music)',
      icon: 'bx bx-link',
      separatorBefore: true,
      action: () => copy('YouTube Music link', musicUrlForTrack(track)),
    },
    {
      label: 'Copy link (YouTube)',
      icon: 'bx bxl-youtube',
      action: () => copy('YouTube link', trackYouTubeUrl(track.videoId)),
    },
  ];
}

/** Menu for a playlist. */
export function playlistMenu(playlist: Playlist): ContextMenuItem[] {
  const canPlay = !!get(authStore);
  const pinned = isPinned(playlist.browseId);
  return [
    {
      label: 'Play',
      icon: 'bx bx-play',
      disabled: !canPlay,
      action: () => {
        if (!get(authStore)) return announceSignInRequired();
        void playPlaylist(playlist, false);
      },
    },
    {
      label: 'Shuffle play',
      icon: 'bx bx-shuffle',
      disabled: !canPlay,
      action: () => {
        if (!get(authStore)) return announceSignInRequired();
        void playPlaylist(playlist, true);
      },
    },
    {
      label: pinned ? 'Unpin playlist' : 'Pin playlist',
      icon: pinned ? 'bx bxs-pin' : 'bx bx-pin',
      separatorBefore: true,
      action: () => void togglePin(playlist),
    },
    {
      label: 'Copy link (YouTube Music)',
      icon: 'bx bx-link',
      separatorBefore: true,
      action: () => copy('YouTube Music link', musicUrlForPlaylist(playlist)),
    },
    {
      label: 'Copy link (YouTube)',
      icon: 'bx bxl-youtube',
      action: () => copy('YouTube link', playlistYouTubeUrl(playlist.browseId)),
    },
  ];
}
