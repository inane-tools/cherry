// Playlist editing: create, add songs, remove songs, rename / re-describe.
//
// All of these are authenticated writes (see `InnertubeClient`). They are
// applied **optimistically**: YouTube's read-after-write can lag, and a full
// refetch of a long playlist (one request per ~100 tracks) is slow, so the
// change is reflected locally at once and only the changed playlist's cache is
// dropped — the next time it is opened it refetches from YouTube.

import { get } from 'svelte/store';
import type { Playlist, Thumbnail, Track } from '$lib/core/models';
import { bestThumbnail } from '$lib/core/models';
import {
  addTracksToPlaylist,
  createPlaylist,
  getActiveChannel,
  getPlaylistMeta,
  removeTrackFromPlaylist,
  renamePlaylist,
  setPlaylistCustomThumbnail,
  setPlaylistDescription,
} from '$lib/infra/ytmusic/InnertubeClient';
import { cacheClear } from '$lib/infra/storage/cache';
import { addPlaylistLocally, addablePlaylistsStore, renamePlaylistLocally } from './addablePlaylists';
import { authStore } from './auth';
import { notify } from './contextMenu';
import { openPage } from './navigation';
import { errorMessage, invokeStrict } from './platform';
import { openPlaylistPicker } from './playlistPicker';
import { openPlaylistStore, openPlaylistTracks, playlistStore } from './playlists';
import { settingsStore, updateSettings } from './settings';

function requireSession(): boolean {
  if (get(authStore)) return true;
  notify('Sign in with YouTube Music to edit playlists.');
  return false;
}

/** Only the playlist that changed is dropped from the cache, not every one. */
function invalidateCollection(browseId: string): void {
  cacheClear(`collection:${getActiveChannel()}:${browseId}`);
}

function invalidateLibrary(): void {
  cacheClear(`library:${getActiveChannel()}:`);
}

/** Drop the cached header (title/description/art) for one playlist. */
function invalidateMeta(browseId: string): void {
  cacheClear(`meta:${getActiveChannel()}:${browseId}`);
}

/**
 * Apply a local edit to the open playlist so the page updates immediately.
 *
 * No-op when a different playlist is open — that page has nothing to change.
 */
function updateOpenTracks(browseId: string, update: (tracks: Track[]) => Track[]): void {
  if (get(openPlaylistStore)?.browseId !== browseId) return;
  openPlaylistTracks.update(update);
}

// ── Default playlist ───────────────────────────────────────────────

/** The playlist "Add to playlist" saves to without asking, if it still exists. */
export function getDefaultPlaylist(): Playlist | null {
  const id = get(settingsStore).defaultPlaylistBrowseId;
  if (!id) return null;
  // If the editable set is known and does not contain it, treat the default as
  // unset: asking is better than writing to a playlist we cannot edit.
  const addable = get(addablePlaylistsStore);
  if (addable.length > 0 && !addable.some((p) => p.browseId === id)) return null;
  return (
    get(playlistStore).find((p) => p.browseId === id) ??
    addable.find((p) => p.browseId === id) ??
    null
  );
}

export async function setDefaultPlaylist(playlist: Playlist | null): Promise<void> {
  await updateSettings({
    defaultPlaylistBrowseId: playlist?.browseId ?? '',
    defaultPlaylistTitle: playlist?.title ?? '',
  });
}

// ── Mutations ──────────────────────────────────────────────────────

export async function addTracksTo(playlist: Playlist, tracks: Track[]): Promise<boolean> {
  if (!requireSession()) return false;
  const additions = tracks.filter((t) => t.videoId);
  if (additions.length === 0) return false;
  try {
    await addTracksToPlaylist(playlist.browseId, additions.map((t) => t.videoId), get(authStore));
    invalidateCollection(playlist.browseId);
    // YouTube appends to the end, so mirror that locally instead of re-fetching.
    updateOpenTracks(playlist.browseId, (list) => [...list, ...additions]);
    notify(
      additions.length === 1
        ? `Added to ${playlist.title}`
        : `Added ${additions.length} songs to ${playlist.title}`,
    );
    return true;
  } catch (e) {
    notify(errorMessage(e, 'Could not add to the playlist.'));
    return false;
  }
}

export async function createNewPlaylist(title: string, tracks: Track[] = []): Promise<string | null> {
  if (!requireSession()) return null;
  const name = title.trim();
  if (!name) {
    notify('Give the playlist a name.');
    return null;
  }
  try {
    const id = await createPlaylist(name, tracks.map((t) => t.videoId), get(authStore));
    // Show it in the rail immediately; the next library refresh fills in the
    // real metadata (thumbnail/author) once YouTube returns it.
    const optimistic: Playlist = { browseId: id, title: name, thumbnails: [] };
    playlistStore.update((list) => [optimistic, ...list.filter((p) => p.browseId !== id)]);
    addPlaylistLocally(optimistic);
    invalidateLibrary();
    notify(
      tracks.length > 0 ? `Created “${name}” with ${tracks.length} songs` : `Created “${name}”`,
    );
    return id;
  } catch (e) {
    notify(errorMessage(e, 'Could not create the playlist.'));
    return null;
  }
}

export async function removeTrackFrom(playlist: Playlist, track: Track): Promise<void> {
  if (!requireSession()) return;
  try {
    await removeTrackFromPlaylist(playlist.browseId, track.videoId, get(authStore));
    invalidateCollection(playlist.browseId);
    // Remove the first matching row (playlists may hold duplicates).
    updateOpenTracks(playlist.browseId, (list) => {
      const at = list.findIndex((t) => t.videoId === track.videoId);
      return at < 0 ? list : [...list.slice(0, at), ...list.slice(at + 1)];
    });
    notify(`Removed “${track.title}”`);
  } catch (e) {
    notify(errorMessage(e, 'Could not remove the track.'));
  }
}

export async function updatePlaylistDetails(
  playlist: Playlist,
  title: string,
  description: string | null,
): Promise<boolean> {
  if (!requireSession()) return false;
  const name = title.trim();
  try {
    if (name && name !== playlist.title) {
      await renamePlaylist(playlist.browseId, name, get(authStore));
    }
    // `null` = the current description could not be read; leave it untouched.
    if (description !== null) {
      await setPlaylistDescription(playlist.browseId, description, get(authStore));
    }
    if (name) {
      // Update the rail, the editable list and the open header in place (no
      // refetch, no history).
      playlistStore.update((list) =>
        list.map((p) => (p.browseId === playlist.browseId ? { ...p, title: name } : p)),
      );
      renamePlaylistLocally(playlist.browseId, name);
      if (get(openPlaylistStore)?.browseId === playlist.browseId) {
        openPage({ view: 'playlist', entity: { ...playlist, title: name } });
      }
    }
    invalidateMeta(playlist.browseId);
    invalidateLibrary();
    notify('Playlist updated');
    return true;
  } catch (e) {
    notify(errorMessage(e, 'Could not update the playlist.'));
    return false;
  }
}

/** Update the rail entry and the open page with new artwork. */
function applyThumbnails(playlist: Playlist, thumbnails: Thumbnail[]): void {
  playlistStore.update((list) =>
    list.map((p) => (p.browseId === playlist.browseId ? { ...p, thumbnails } : p)),
  );
  if (get(openPlaylistStore)?.browseId === playlist.browseId) {
    openPage({ view: 'playlist', entity: { ...playlist, thumbnails } });
  }
}

/**
 * Set a custom cover image on a playlist.
 *
 * Two steps: Rust uploads the bytes and returns an encrypted blob id (the
 * upload endpoints are not Innertube calls, so they need the browser
 * `SAPISIDHASH` signed request), then the normal edit endpoint attaches it with
 * `ACTION_SET_CUSTOM_THUMBNAIL`.
 *
 * The chosen image is applied to the UI immediately (YouTube's own header can
 * take a while to reflect a new custom thumbnail, and this is what makes the
 * change visible at all), then swapped for the server URL if/when it appears.
 */
export async function setPlaylistImage(
  playlist: Playlist,
  dataBase64: string,
  mime: string,
): Promise<boolean> {
  const session = get(authStore);
  if (!session) {
    notify('Sign in with YouTube Music to change playlist art.');
    return false;
  }
  try {
    const blobId = await invokeStrict<string>(
      'upload_playlist_thumbnail',
      { cookie: session.cookie, dataBase64, mime },
      'Changing playlist art needs the desktop app.',
    );
    await setPlaylistCustomThumbnail(playlist.browseId, blobId, session);
    invalidateMeta(playlist.browseId);

    // Show the new art right away (YouTube's own header can lag behind a new
    // custom thumbnail), then swap in the server URL once it differs.
    const localUrl = `data:${mime};base64,${dataBase64}`;
    applyThumbnails(playlist, [{ url: localUrl }]);
    const previous = bestThumbnail(playlist.thumbnails, 512);
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
      const meta = await getPlaylistMeta(playlist.browseId, session);
      const next = bestThumbnail(meta?.thumbnails ?? [], 512);
      if (next && next !== previous && next !== localUrl) {
        applyThumbnails(playlist, meta?.thumbnails ?? []);
        break;
      }
    }

    notify('Playlist image updated');
    return true;
  } catch (e) {
    notify(errorMessage(e, 'Could not update the playlist image.'));
    return false;
  }
}

/**
 * "Add to playlist" was chosen for a track.
 *
 * Saves straight to the default playlist when one is set, otherwise opens the
 * picker so the user is always asked before anything is written.
 */
export async function saveTrack(track: Track): Promise<void> {
  if (!requireSession()) return;
  const preferred = getDefaultPlaylist();
  if (preferred) {
    await addTracksTo(preferred, [track]);
    return;
  }
  openPlaylistPicker([track]);
}
