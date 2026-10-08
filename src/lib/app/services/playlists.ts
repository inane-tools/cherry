import { get, writable } from 'svelte/store';
import type { Playlist, Track } from '$lib/core/models';
import { getHomeSections, getLibraryPlaylists, getPlaylistMeta, streamCollectionTracks } from '$lib/infra/ytmusic/InnertubeClient';
import type { HomeSection } from '$lib/infra/ytmusic/rawHome';
import { cacheClear } from '$lib/infra/storage/cache';
import { authStore } from './auth';
import { initChannel } from './account';
import { openPage } from './navigation';
import { enqueue } from './queue';
import { playTracks, playTracksShuffled } from './player';

export const playlistStore = writable<Playlist[]>([]);
export const homeSectionsStore = writable<HomeSection[]>([]);
export const homeLoading = writable(false);
export const libraryLoading = writable(false);
export const libraryError = writable<string | null>(null);

// ── Currently open playlist ─────────────────────────────────────
export const openPlaylistStore = writable<Playlist | null>(null);
export const openPlaylistTracks = writable<Track[]>([]);
export const openPlaylistDescription = writable<string | null>(null);
export const openPlaylistLoading = writable(false);
export const openPlaylistError = writable<string | null>(null);

let inflight: Promise<void> | null = null;

/** Loads the playlist rail for the *active channel*. */
export function loadLibrary(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    // Everything, including the signed-out early return, has to clear
    // `inflight` in a `finally`. If the signed-out path returned before the
    // try block, `inflight` kept a resolved promise forever and every later
    // load (notably the sidebar "Retry" after signing in) was a silent no-op.
    try {
      const session = get(authStore);
      if (!session) {
        playlistStore.set([]);
        libraryError.set(null);
        return;
      }
      libraryLoading.set(true);
      libraryError.set(null);
      // The channel context decides which library we get, so establish it
      // before asking for playlists.
      await initChannel();
      const playlists = await getLibraryPlaylists(session);
      playlistStore.set(playlists);
      if (playlists.length === 0) {
        libraryError.set('No playlists found for this channel.');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // eslint-disable-next-line no-console
      console.error('[cherry] library load failed:', e);
      libraryError.set(message);
    } finally {
      libraryLoading.set(false);
      inflight = null;
    }
  })();
  return inflight;
}

let homeInflight: Promise<void> | null = null;

/** Loads the real YouTube Music home feed for the active channel. */
export function loadHome(): Promise<void> {
  const session = get(authStore);
  if (!session) {
    homeSectionsStore.set([]);
    return Promise.resolve();
  }
  if (homeInflight) return homeInflight;
  homeInflight = (async () => {
    homeLoading.set(true);
    try {
      await initChannel();
      homeSectionsStore.set(await getHomeSections(session));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[cherry] home feed failed:', e);
      homeSectionsStore.set([]);
    } finally {
      homeLoading.set(false);
      homeInflight = null;
    }
  })();
  return homeInflight;
}

/**
 * Refresh everything that depends on the channel context.
 *
 * Called on sign-in and after the cache is cleared, so it must be a genuine
 * refetch: it resets the in-flight guards and the *channel* cache (which is
 * what decides which library we even ask for). Without this, a login right
 * after a clear could resolve to an in-flight/leftover promise from the
 * signed-out state and the rail stayed empty.
 */
export async function reloadAll(): Promise<void> {
  cacheClear('channels:');
  cacheClear('probe:');
  // Drop the in-flight guards so the reload is a genuine refetch.
  inflight = null;
  homeInflight = null;
  await initChannel(true);
  await Promise.all([loadHome(), loadLibrary()]);
}

/**
 * Hard refresh (Settings → Refresh playlists): forget cached channel/feed
 * data, re-resolve the channel context and reload the rail + home feed, so the
 * button actually re-fetches instead of returning the cached list.
 */
export async function refreshLibrary(): Promise<void> {
  cacheClear('channels:');
  cacheClear('probe:');
  cacheClear('home:');
  // Drop the in-flight guards so the reload is a genuine refetch.
  inflight = null;
  homeInflight = null;
  await initChannel(true);
  await Promise.all([loadLibrary(), loadHome()]);
}

/**
 * Open a playlist (from the rail, a home card or search): navigate to the
 * playlist page. The view calls `loadOpenPlaylist` once it is mounted, so Back
 * restores the page without a redundant reload.
 */
export function openPlaylist(playlist: Playlist): void {
  openPage({ view: 'playlist', entity: playlist });
}

/**
 * Play a playlist straight from a context menu without opening its page.
 *
 * Resolves the collection tracks then hands them to the player (optionally
 * shuffled). The playlist page is not navigated to, so this never disturbs
 * where the user is.
 */
export async function playPlaylist(playlist: Playlist, shuffle = false): Promise<void> {
  const session = get(authStore);
  if (!session) return;
  try {
    await initChannel();
    // Start on the first page (and enqueue the rest as it streams in) so a large
    // playlist begins playing immediately instead of after every page is read.
    let started = false;
    let seen = 0;
    await streamCollectionTracks(playlist.browseId, session, (partial) => {
      const fresh = partial.slice(seen);
      seen = partial.length;
      if (fresh.length === 0) return;
      if (!started) {
        started = true;
        if (shuffle) void playTracksShuffled(fresh);
        else void playTracks(fresh, 0);
      } else {
        enqueue(fresh);
      }
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[cherry] could not play playlist:', e);
  }
}

// Guards against out-of-order responses: opening playlist A then B quickly must
// not let A's (slower) fetch overwrite B's tracks.
let openSeq = 0;

/** Load the tracks for the playlist currently on screen. */
export async function loadOpenPlaylist(playlist: Playlist): Promise<void> {
  const id = ++openSeq;
  openPlaylistStore.set(playlist);
  // Clear synchronously so the previous playlist's tracks can never flash under
  // the new header while this load is in flight.
  openPlaylistTracks.set([]);
  openPlaylistDescription.set(null);
  openPlaylistError.set(null);
  const session = get(authStore);
  if (!session) {
    openPlaylistLoading.set(false);
    openPlaylistError.set('Sign in to open playlists.');
    return;
  }
  openPlaylistLoading.set(true);
  try {
    await initChannel();
    // Header metadata (description/art) is independent of the track stream, so
    // fetch it alongside rather than serialising the two.
    void getPlaylistMeta(playlist.browseId, session).then((meta) => {
      if (id !== openSeq) return;
      openPlaylistDescription.set(meta?.description ?? null);
    });
    const tracks = await streamCollectionTracks(playlist.browseId, session, (partial, done) => {
      if (id !== openSeq) return;
      openPlaylistTracks.set(partial);
      // The first page is enough to render and play; drop the skeleton while
      // the remaining pages keep streaming in.
      if (!done) openPlaylistLoading.set(false);
    });
    if (id !== openSeq) return;
    openPlaylistTracks.set(tracks);
    if (tracks.length === 0) {
      openPlaylistError.set('This playlist has no playable tracks.');
    }
  } catch (e) {
    if (id !== openSeq) return;
    openPlaylistError.set(e instanceof Error ? e.message : String(e));
  } finally {
    if (id === openSeq) openPlaylistLoading.set(false);
  }
}
