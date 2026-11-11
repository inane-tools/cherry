// Playlist editing: create, add songs, remove songs, rename / re-describe.
//
// All of these are authenticated writes (see `InnertubeClient`). They are
// reflected locally after YouTube confirms the write. Reads can lag behind,
// so confirmed additions are retained while the changed playlist refreshes.
// Only that playlist's caches are invalidated.

import { get } from 'svelte/store';
import { authIdentity } from '$lib/infra/ytmusic/authContext';
import type { Playlist, Thumbnail, Track } from '$lib/core/models';
import { bestThumbnail } from '$lib/core/models';
import {
  addTracksToPlaylist,
  createPlaylist,
  getPlaylistMeta,
  getPlaylistImageContext,
  removeTrackFromPlaylist,
  renamePlaylist,
  setPlaylistCustomThumbnail,
  setPlaylistDescription,
} from '$lib/infra/ytmusic/InnertubeClient';
import { cacheClear, cacheGet } from '$lib/infra/storage/cache';
import { addPlaylistLocally, addablePlaylistsStore, renamePlaylistLocally } from './addablePlaylists';
import { authStore } from './auth';
import { notify } from './contextMenu';
import { errorMessage, invokeStrict } from './platform';
import { openPlaylistPicker } from './playlistPicker';
import { openPlaylistStore, openPlaylistTracks, playlistStore, refreshEditedPlaylist, recordPlaylistRemoval, recordLibraryPlaylist } from './playlists';
import { settingsStore, updateSettings } from './settings';
import { prependSidebarItem } from './folders';
import { capturePlaylistAccount } from './playlistAccount';

function requireSession(): boolean {
  if (get(authStore)) return true;
  notify('Sign in with YouTube Music to edit playlists.');
  return false;
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

const pendingAdds = new Map<string, Promise<boolean>>();

export function addTracksTo(playlist: Playlist, tracks: Track[]): Promise<boolean> {
  const { session, channel, revision } = capturePlaylistAccount();
  const key = JSON.stringify([authIdentity(session), channel, revision, playlist.browseId, tracks.map(track => track.videoId)]);
  const pending = pendingAdds.get(key);
  if (pending) return pending;
  const operation = addTracksOnce(playlist, tracks).finally(() => {
    if (pendingAdds.get(key) === operation) pendingAdds.delete(key);
  });
  pendingAdds.set(key, operation);
  return operation;
}

async function addTracksOnce(playlist: Playlist, tracks: Track[]): Promise<boolean> {
  if (!requireSession()) return false;
  const additions = tracks.filter((t) => t.videoId);
  if (additions.length === 0) return false;
  const { session, channel, current } = capturePlaylistAccount();
  const baseline = get(openPlaylistStore)?.browseId === playlist.browseId
    ? get(openPlaylistTracks) : cacheGet<Track[]>(`collection:${channel}:${playlist.browseId}`) ?? undefined;
  try {
    await addTracksToPlaylist(playlist.browseId, additions.map((t) => t.videoId), session);
    for (const prefix of ['collection', 'meta']) cacheClear(`${prefix}:${channel}:${playlist.browseId}`);
    cacheClear(`library:${channel}:`);
    if (!current()) return true;
    void refreshEditedPlaylist(playlist, additions, baseline).catch(error => console.warn('[cherry] playlist refresh failed:', error));
    notify(
      additions.length === 1
        ? `Added to ${playlist.title}`
        : `Added ${additions.length} songs to ${playlist.title}`,
    );
    return true;
  } catch (e) {
    if (!current()) return false;
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
  const { session, channel, current } = capturePlaylistAccount();
  try {
    const id = await createPlaylist(name, tracks.map((t) => t.videoId), session);
    cacheClear(`library:${channel}:`);
    cacheClear(`addable:${channel}:`);
    if (!current()) return id;
    // Show it in the rail immediately; the next library refresh fills in the
    // real metadata (thumbnail/author) once YouTube returns it.
    const optimistic: Playlist = { browseId: id, title: name, thumbnails: [], trackCount: 0 };
    recordLibraryPlaylist(optimistic);
    addPlaylistLocally(optimistic);
    if (tracks.length) void refreshEditedPlaylist(optimistic, tracks, [])
      .catch(error => console.warn('[cherry] new playlist refresh failed:', error));
    await prependSidebarItem(id);
    if (!current()) return id;
    notify(
      tracks.length > 0 ? `Created “${name}” with ${tracks.length} songs` : `Created “${name}”`,
    );
    return id;
  } catch (e) {
    if (!current()) return null;
    notify(errorMessage(e, 'Could not create the playlist.'));
    return null;
  }
}

const pendingRemovals = new Set<string>();
export async function removeTrackFrom(playlist: Playlist, track: Track, index?: number): Promise<void> {
  if (!requireSession()) return;
  if (!get(addablePlaylistsStore).some(item => item.browseId === playlist.browseId)) {
    notify('Only playlists you can edit support removing songs.');
    return;
  }
  const { session, channel, revision, current } = capturePlaylistAccount();
  const tracks = get(openPlaylistStore)?.browseId === playlist.browseId ? get(openPlaylistTracks) : [];
  const at = index !== undefined && tracks[index] === track ? index : tracks.indexOf(track);
  const occurrence = at < 0 ? 0 : tracks.slice(0, at).filter(item => item.videoId === track.videoId).length;
  const key = JSON.stringify([authIdentity(session), channel, revision, playlist.browseId, track.playlistEntryId ?? [track.videoId, occurrence]]);
  if (pendingRemovals.has(key)) return;
  pendingRemovals.add(key);
  try {
    const removedEntryId = await removeTrackFromPlaylist(playlist.browseId, track.videoId, session, { playlistEntryId: track.playlistEntryId, occurrence });
    for (const prefix of ['collection', 'meta']) cacheClear(`${prefix}:${channel}:${playlist.browseId}`);
    cacheClear(`library:${channel}:`);
    if (!current()) return;
    recordPlaylistRemoval(playlist, track, removedEntryId ?? track.playlistEntryId);
    notify(`Removed “${track.title}”`);
  } catch (e) {
    if (!current()) return;
    notify(errorMessage(e, 'Could not remove the track.'));
  } finally {
    pendingRemovals.delete(key);
  }
}

export async function updatePlaylistDetails(
  playlist: Playlist,
  title: string,
  description: string | null,
): Promise<boolean> {
  if (!requireSession()) return false;
  const name = title.trim();
  const { session, channel, current } = capturePlaylistAccount();
  try {
    if (name && name !== playlist.title) {
      await renamePlaylist(playlist.browseId, name, session);
      cacheClear(`meta:${channel}:${playlist.browseId}`);
      cacheClear(`library:${channel}:`);
      cacheClear(`addable:${channel}:`);
      if (!current()) return false;
      // A successful rename is retained even if the later description fails.
      recordLibraryPlaylist(playlist, { title: name });
      renamePlaylistLocally(playlist.browseId, name);
    }
    if (!current()) return false;
    // `null` = the current description could not be read; leave it untouched.
    if (description !== null) {
      await setPlaylistDescription(playlist.browseId, description, session);
      cacheClear(`meta:${channel}:${playlist.browseId}`);
      cacheClear(`library:${channel}:`);
    }
    if (!current()) return false;
    notify('Playlist updated');
    return true;
  } catch (e) {
    if (!current()) return false;
    notify(errorMessage(e, 'Could not update the playlist.'));
    return false;
  }
}

/** Update the rail entry and the open page with new artwork. */
function applyThumbnails(playlist: Playlist, thumbnails: Thumbnail[]): void {
  recordLibraryPlaylist(playlist, { thumbnails });
  addablePlaylistsStore.update(list => list.map(item => item.browseId === playlist.browseId ? { ...item, thumbnails } : item));
}

/**
 * Set a custom cover image on a playlist.
 *
 * Two steps: The desktop host uploads the bytes and returns an encrypted blob id (the
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
  onError?: (message: string) => void,
): Promise<boolean> {
  const { session, channel, current } = capturePlaylistAccount();
  if (!session) {
    notify('Sign in with YouTube Music to change playlist art.');
    return false;
  }
  try {
    const uploadContext = await getPlaylistImageContext(session);
    if (!current()) return false;
    const blobId = await invokeStrict<string>(
      'upload_playlist_thumbnail',
      { cookie: session.cookie, dataBase64, mime, accountIndex: session.accountIndex ?? 0, channelId: channel, playlistId: playlist.browseId, ...uploadContext },
      'Changing playlist art needs the desktop app.',
    );
    if (!current()) return false;
    await setPlaylistCustomThumbnail(playlist.browseId, blobId, session);
    cacheClear(`meta:${channel}:${playlist.browseId}`);
    cacheClear(`library:${channel}:`);
    if (!current()) return false;

    // Show the new art right away (YouTube's own header can lag behind a new
    // custom thumbnail), then swap in the server URL once it differs.
    const localUrl = `data:${mime};base64,${dataBase64}`;
    applyThumbnails(playlist, [{ url: localUrl }]);
    const previous = bestThumbnail(playlist.thumbnails, 512);
    // A new playlist has no previous cover to compare with. Keep the confirmed
    // upload preview rather than replacing it with a lagging default thumbnail.
    for (let attempt = 0; previous && attempt < 3; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
      if (!current()) return false;
      cacheClear(`meta:${channel}:${playlist.browseId}`);
      const meta = await getPlaylistMeta(playlist.browseId, session);
      if (!current()) return false;
      const next = bestThumbnail(meta?.thumbnails ?? [], 512);
      if (next && next !== previous && next !== localUrl) {
        applyThumbnails(playlist, meta?.thumbnails ?? []);
        break;
      }
    }

    notify('Playlist image updated');
    return true;
  } catch (e) {
    if (!current()) return false;
    const message = errorMessage(e, 'Could not update the playlist image.');
    onError?.(message);
    notify(message);
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
