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
import { getDefaultPlaylist, removeTrackFrom, saveTrack, setDefaultPlaylist } from './playlistEdit';
import { isPlaylistOwned, isPlaylistSaved, ownershipKnown, savePlaylist, unsavePlaylist } from './playlistLibrary';
import { openPlaylistEditor } from './playlistEditor';
import { openPlaylistPicker } from './playlistPicker';

async function copy(label: string, url: string): Promise<void> {
  const ok = await copyText(url);
  notify(ok ? `${label} copied` : 'Could not copy to the clipboard');
}

/**
 * Menu for a single track. `list`/`index` let "Play" use the row's context;
 * `playlist` is passed when the row is shown on a playlist page, which adds the
 * "remove from this playlist" action.
 */
export function trackMenu(
  track: Track,
  list?: Track[],
  index = 0,
  playlist?: Playlist,
): ContextMenuItem[] {
  const signedIn = !!get(authStore);
  const canPlay = !!(signedIn && track.videoId);
  const preferred = getDefaultPlaylist();

  const items: ContextMenuItem[] = [
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
  ];

  if (signedIn) {
    items.push({
      label: preferred ? `Add to “${preferred.title}”` : 'Add to playlist…',
      icon: 'bx bx-plus',
      separatorBefore: true,
      action: () => void saveTrack(track),
    });
    if (preferred) {
      items.push({
        label: 'Add to another playlist…',
        icon: 'bx bx-list-plus',
        action: () => openPlaylistPicker([track]),
      });
    }
    if (playlist) {
      items.push({
        label: 'Remove from this playlist',
        icon: 'bx bx-trash',
        action: () => void removeTrackFrom(playlist, track),
      });
    }
  }

  items.push(
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
  );

  return items;
}

/** Menu for a playlist. */
export function playlistMenu(playlist: Playlist): ContextMenuItem[] {
  const signedIn = !!get(authStore);
  const canPlay = signedIn;
  const pinned = isPinned(playlist.browseId);
  const isDefault = getDefaultPlaylist()?.browseId === playlist.browseId;
  const owned = isPlaylistOwned(playlist.browseId);
  const saved = isPlaylistSaved(playlist.browseId);

  const items: ContextMenuItem[] = [
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
  ];

  if (signedIn) {
    if (owned) {
      items.push({
        label: 'Edit details…',
        icon: 'bx bx-pencil',
        action: () => openPlaylistEditor(playlist),
      });
      items.push({
        label: isDefault ? 'Clear default playlist' : 'Set as default playlist',
        icon: isDefault ? 'bx bx-check-circle' : 'bx bx-target-lock',
        action: () => void setDefaultPlaylist(isDefault ? null : playlist),
      });
    } else if (ownershipKnown()) {
      // Not your playlist: the only library action is save / unsave. (Until the
      // editable set loads we cannot tell, so no destructive action is offered.)
      items.push({
        label: saved ? 'Remove from library' : 'Save to library',
        icon: saved ? 'bx bxs-bookmark' : 'bx bx-bookmark',
        action: () => void (saved ? unsavePlaylist(playlist) : savePlaylist(playlist)),
      });
    }
  }

  items.push(
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
  );

  return items;
}
