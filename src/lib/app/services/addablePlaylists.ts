// The signed-in user's *editable* playlists (created by them / collaborators).
//
// The Music library also lists playlists the user merely saved, and adding to
// one of those fails. This uses the add-to-playlist menu endpoint, which returns
// only writable playlists, and backs both the "Add to playlist" picker and the
// "default save playlist" setting so neither ever offers a non-editable target.
//
// The set is **per brand channel**, and at startup this is first requested
// *before* the channel is resolved — the response can then be empty, which looks
// exactly like "ownership unknown" (no rail separator, no edit/save actions)
// until something else re-triggers a load. So a channel change forces a reload.

import { get, writable } from 'svelte/store';
import type { AuthSession, Playlist } from '$lib/core/models';
import { getActiveChannel, getAddablePlaylists } from '$lib/infra/ytmusic/InnertubeClient';
import { activeChannelStore } from './account';
import { authStore } from './auth';
import { playerStore } from './player';
import { playlistStore } from './playlists';

export const addablePlaylistsStore = writable<Playlist[]>([]);
export const addablePlaylistsLoading = writable(false);

/** Session+channel the current list belongs to, so it is refreshed on change. */
let loadedFor = '';
let inflight: Promise<Playlist[]> | null = null;

function currentKey(session: AuthSession): string {
  return `${session.cookie}::${getActiveChannel()}`;
}

/** The menu rows carry no artwork; borrow it from the loaded library. */
function enrich(list: Playlist[]): Playlist[] {
  const library = get(playlistStore);
  return list.map((playlist) => {
    const match = library.find((l) => l.browseId === playlist.browseId);
    return match && match.thumbnails.length > 0
      ? { ...playlist, thumbnails: match.thumbnails }
      : playlist;
  });
}

/**
 * The add-to-playlist menu is normally opened *for a video*; callers that list
 * playlists without one (the default-playlist setting) must still pass some
 * video or the request comes back empty. The returned set of editable playlists
 * does not depend on the video — only the menu's "already added" state does — so
 * the current track (or a probe) is used.
 */
const PROBE_VIDEO_ID = 'dQw4w9WgXcQ';
function withProbe(videoIds: string[]): string[] {
  if (videoIds.length > 0) return videoIds;
  const current = get(playerStore).track?.videoId;
  return [current || PROBE_VIDEO_ID];
}

/**
 * Load the editable playlists (once per account/channel).
 *
 * `videoIds` only affect the menu's "already contains this song" state; the set
 * of editable playlists does not depend on them, so the first successful load
 * is reused. Failures leave the previous list in place rather than emptying it.
 */
export function loadAddablePlaylists(videoIds: string[] = []): Promise<Playlist[]> {
  const session = get(authStore);
  if (!session) {
    addablePlaylistsStore.set([]);
    loadedFor = '';
    return Promise.resolve([]);
  }
  const key = currentKey(session);
  if (inflight) return inflight;
  if (loadedFor === key && get(addablePlaylistsStore).length > 0) {
    return Promise.resolve(get(addablePlaylistsStore));
  }

  const run = (async () => {
    addablePlaylistsLoading.set(true);
    try {
      const list = enrich(await getAddablePlaylists(session, withProbe(videoIds)));
      // A channel switch mid-flight invalidates this result.
      if (key !== currentKey(session)) return get(addablePlaylistsStore);
      addablePlaylistsStore.set(list);
      if (list.length > 0) loadedFor = key;
      return list;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[cherry] could not load editable playlists:', e);
      return get(addablePlaylistsStore);
    } finally {
      addablePlaylistsLoading.set(false);
    }
  })();
  inflight = run;
  void run.finally(() => {
    if (inflight === run) inflight = null;
  });
  return run;
}

/** Keep the list in step after a create/rename without a refetch. */
export function addPlaylistLocally(playlist: Playlist): void {
  addablePlaylistsStore.update((list) => [
    playlist,
    ...list.filter((p) => p.browseId !== playlist.browseId),
  ]);
}

export function renamePlaylistLocally(browseId: string, title: string): void {
  addablePlaylistsStore.update((list) =>
    list.map((p) => (p.browseId === browseId ? { ...p, title } : p)),
  );
}

/** Forget the list (sign-out / clear data / channel switch). */
export function resetAddablePlaylists(): void {
  loadedFor = '';
  inflight = null;
  addablePlaylistsStore.set([]);
}

// The editable set is per channel; reload when the active channel changes. This
// is what makes it load correctly at startup (the first request runs before the
// channel is resolved) and on a channel switch.
let lastChannel: string | null = null;
activeChannelStore.subscribe((profile) => {
  const pageId = profile?.pageId ?? '';
  if (lastChannel === null) {
    lastChannel = pageId;
    return;
  }
  if (pageId !== lastChannel) {
    lastChannel = pageId;
    resetAddablePlaylists();
    void loadAddablePlaylists();
  }
});

// Drop the previous account's editable playlists the moment the session changes.
let lastCookie: string | null = null;
authStore.subscribe((session) => {
  const cookie = session?.cookie ?? '';
  if (lastCookie === null) {
    lastCookie = cookie;
    return;
  }
  if (cookie !== lastCookie) {
    lastCookie = cookie;
    resetAddablePlaylists();
  }
});
