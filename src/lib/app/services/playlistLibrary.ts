// Saving / unsaving playlists.
//
// "Saved" is the library action (`like/like`) for playlists you did not create —
// distinct from *editing* your own. Whether a playlist is yours comes from the
// editable set (`addablePlaylistsStore`); whether it is saved comes from the
// library list.

import { get } from 'svelte/store';
import type { Playlist } from '$lib/core/models';
import {
  addPlaylistToLibrary,
  getActiveChannel,
  removePlaylistFromLibrary,
} from '$lib/infra/ytmusic/InnertubeClient';
import { cacheClear } from '$lib/infra/storage/cache';
import { addablePlaylistsStore } from './addablePlaylists';
import { authStore } from './auth';
import { notify } from './contextMenu';
import { playlistStore } from './playlists';

/** True when the user created (or can edit) the playlist. */
export function isPlaylistOwned(browseId: string): boolean {
  return get(addablePlaylistsStore).some((p) => p.browseId === browseId);
}

/**
 * Whether the editable set has loaded. Until it has, ownership is unknown, so
 * callers must not offer a library action that could remove one of the user's
 * own playlists.
 */
export function ownershipKnown(): boolean {
  return get(addablePlaylistsStore).length > 0;
}

/** True when the playlist is in the user's library. */
export function isPlaylistSaved(browseId: string): boolean {
  return get(playlistStore).some((p) => p.browseId === browseId);
}

export async function savePlaylist(playlist: Playlist): Promise<boolean> {
  const session = get(authStore);
  if (!session) {
    notify('Sign in with YouTube Music to save playlists.');
    return false;
  }
  try {
    await addPlaylistToLibrary(playlist.browseId, session);
    // Optimistic: show it in the rail right away; the next library refresh
    // fills in real metadata.
    playlistStore.update((list) =>
      list.some((p) => p.browseId === playlist.browseId) ? list : [playlist, ...list],
    );
    cacheClear(`library:${getActiveChannel()}:`);
    notify(`Saved “${playlist.title}”`);
    return true;
  } catch (e) {
    notify(e instanceof Error ? e.message : 'Could not save the playlist.');
    return false;
  }
}

export async function unsavePlaylist(playlist: Playlist): Promise<boolean> {
  // Safety net: never let your own playlist be removed from the library.
  if (isPlaylistOwned(playlist.browseId)) {
    notify('That is your own playlist — you can only delete it, not unsave it.');
    return false;
  }
  const session = get(authStore);
  if (!session) return false;
  try {
    await removePlaylistFromLibrary(playlist.browseId, session);
    playlistStore.update((list) => list.filter((p) => p.browseId !== playlist.browseId));
    cacheClear(`library:${getActiveChannel()}:`);
    notify(`Removed “${playlist.title}” from your library`);
    return true;
  } catch (e) {
    notify(e instanceof Error ? e.message : 'Could not remove the playlist.');
    return false;
  }
}
