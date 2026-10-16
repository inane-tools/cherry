import { authIdentity } from '$lib/infra/ytmusic/authContext';
import { get, writable } from 'svelte/store';
import type { Playlist, Track } from '$lib/core/models';
import { getActiveChannel, getHomePage, getLibraryPlaylists, getPlaylistMeta, streamCollectionTracks } from '$lib/infra/ytmusic/InnertubeClient';
import type { HomeSection, HomeFilter } from '$lib/infra/ytmusic/rawHome';
import { cacheClear } from '$lib/infra/storage/cache';
import { authStore } from './auth';
import { initChannel } from './account';
import { openPage, pageStore } from './navigation';
import { enqueue } from './queue';
import { playTracks, playTracksShuffled } from './player';
import { rememberPlaylist } from './playlistShortcuts';

export const playlistStore = writable<Playlist[]>([]);
export const homeSectionsStore = writable<HomeSection[]>([]);
export const homeLoading = writable(false);
export const homeContinuationStore = writable<string | null>(null);
export const homeMoreLoading = writable(false);
export const homeMoreError = writable('');
export const homeFiltersStore = writable<HomeFilter[]>([]);
export const homeFilterStore = writable<HomeFilter | null>(null);
export const libraryLoading = writable(false);
export const libraryError = writable<string | null>(null);

// ── Currently open playlist ─────────────────────────────────────
export const openPlaylistStore = writable<Playlist | null>(null);
export const openPlaylistTracks = writable<Track[]>([]);
export const openPlaylistDescription = writable<string | null>(null);
export const openPlaylistLoading = writable(false);
export const openPlaylistError = writable<string | null>(null);

let inflight: Promise<void> | null = null;
let homeInflight: Promise<void> | null = null;
let moreInflight: Promise<void> | null = null;
let homeGeneration = 0;
const homeTokens = new Set<string>();
let generation = 0;
let lastArtworkRefresh = -Infinity;

/** Recover stale artwork URLs without resetting the channel or current page. */
export function refreshPlaylistArtwork(): void {
  if (!get(authStore) || inflight || Date.now() - lastArtworkRefresh < 60_000) return;
  lastArtworkRefresh = Date.now();
  cacheClear('library:');
  void loadLibrary();
}

function invalidateLoads(): number {
  generation++;
  openSeq++;
  inflight = null;
  homeInflight = null;
  moreInflight = null;
  homeGeneration++;
  homeFilterStore.set(null);
  homeFiltersStore.set([]);
  homeTokens.clear();
  homeContinuationStore.set(null);
  homeMoreLoading.set(false);
  homeMoreError.set('');
  libraryLoading.set(false);
  homeLoading.set(false);
  openPlaylistLoading.set(false);
  return generation;
}

/** Loads the playlist rail for the *active channel*. */
export function loadLibrary(): Promise<void> {
  const session = get(authStore);
  if (!session) {
    playlistStore.set([]);
    libraryError.set(null);
    return Promise.resolve();
  }
  if (inflight) return inflight;
  const id = generation;
  let channel: string | undefined;
  const stale = () => id !== generation || authIdentity(get(authStore)) !== authIdentity(session)
    || (channel !== undefined && channel !== getActiveChannel());
  inflight = (async () => {
    try {
      libraryLoading.set(true);
      libraryError.set(null);
      // The channel context decides which library we get, so establish it
      // before asking for playlists.
      await initChannel();
      if (stale()) return;
      channel = getActiveChannel();
      const playlists = await getLibraryPlaylists(session);
      if (stale()) return;
      playlistStore.set(playlists);
      if (playlists.length === 0) {
        libraryError.set('No playlists found for this channel.');
      }
    } catch (e) {
      if (stale()) return;
      const message = e instanceof Error ? e.message : String(e);
      // eslint-disable-next-line no-console
      console.error('[cherry] library load failed:', e);
      libraryError.set(message);
    } finally {
      if (id === generation) {
        libraryLoading.set(false);
        inflight = null;
      }
    }
  })();
  return inflight;
}

/** Loads the real YouTube Music home feed for the active channel. */
export function loadHome(): Promise<void> {
  const session = get(authStore);
  if (!session) {
    homeSectionsStore.set([]);
    return Promise.resolve();
  }
  if (homeInflight) return homeInflight;
  const id = generation;
  const homeId = ++homeGeneration;
  let channel: string | undefined;
  const stale = () => id !== generation || homeId !== homeGeneration || authIdentity(get(authStore)) !== authIdentity(session)
    || (channel !== undefined && channel !== getActiveChannel());
  homeInflight = (async () => {
    homeLoading.set(true);
    try {
      await initChannel();
      if (stale()) return;
      channel = getActiveChannel();
      const page = await getHomePage(session, undefined, get(homeFilterStore));
      if (stale()) return;
      homeSectionsStore.set(page.sections);
      homeTokens.clear();
      homeContinuationStore.set(page.continuation);
      homeMoreError.set('');
      if (page.filters?.length) homeFiltersStore.set(page.filters);
    } catch (e) {
      if (stale()) return;
      // eslint-disable-next-line no-console
      console.error('[cherry] home feed failed:', e);
      homeSectionsStore.set([]);
    } finally {
      if (id === generation && homeId === homeGeneration) {
        homeLoading.set(false);
        homeInflight = null;
      }
    }
  })();
  return homeInflight;
}

/** Load another feed page on demand; discard responses from an old account. */
export function loadMoreHome(): Promise<void> {
  const session = get(authStore);
  const token = get(homeContinuationStore);
  if (!session || !token || homeTokens.has(token)) return Promise.resolve();
  if (moreInflight) return moreInflight;
  const id = generation;
  const homeId = homeGeneration;
  const channel = getActiveChannel();
  const stale = () => id !== generation || homeId !== homeGeneration || authIdentity(get(authStore)) !== authIdentity(session) || getActiveChannel() !== channel;
  homeMoreLoading.set(true);
  homeMoreError.set('');
  let run: Promise<void> | undefined;
  run = (async () => {
    try {
      const page = await getHomePage(session, token, get(homeFilterStore));
      if (stale()) return;
      homeTokens.add(token);
      const key = (section: HomeSection) => JSON.stringify([section.title, section.cards.map((c) => c.browseId), section.songs.map((s) => s.videoId)]);
      homeSectionsStore.update((sections) => {
        const seen = new Set(sections.map(key));
        return [...sections, ...page.sections.filter((section) => { const identity = key(section); if (seen.has(identity)) return false; seen.add(identity); return true; })];
      });
      homeContinuationStore.set(page.continuation && !homeTokens.has(page.continuation) && homeTokens.size < 20 ? page.continuation : null);
    } catch { if (!stale()) homeMoreError.set('Could not load more recommendations. Try again.'); }
    finally { if (!stale()) homeMoreLoading.set(false); if (moreInflight === run) moreInflight = null; }
  })();
  moreInflight = run;
  return run;
}

export function refreshHome(): Promise<void> {
  cacheClear(`home:${getActiveChannel()}:`);
  return loadHome();
}

export function selectHomeFilter(filter: HomeFilter | null): Promise<void> {
  homeGeneration++;
  homeInflight = null;
  moreInflight = null;
  homeTokens.clear();
  homeContinuationStore.set(null);
  homeMoreLoading.set(false);
  homeMoreError.set('');
  homeFilterStore.set(filter);
  homeSectionsStore.set([]);
  return loadHome();
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
  const id = invalidateLoads();
  cacheClear('channels:');
  cacheClear('probe:');
  cacheClear('library:');
  cacheClear('home:');
  await initChannel(true);
  if (id !== generation) return;
  await Promise.all([loadHome(), loadLibrary()]);
}

/**
 * Hard refresh (Settings → Refresh playlists): forget cached channel/feed
 * data, re-resolve the channel context and reload the rail + home feed, so the
 * button actually re-fetches instead of returning the cached list.
 */
export async function refreshLibrary(): Promise<void> {
  await reloadAll();
}

/**
 * Open a playlist (from the rail, a home card or search): navigate to the
 * playlist page. The view calls `loadOpenPlaylist` once it is mounted, so Back
 * restores the page without a redundant reload.
 */
export function openPlaylist(playlist: Playlist): void {
  rememberPlaylist(playlist);
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
  const id = generation;
  let channel: string | undefined;
  const stale = () => id !== generation || authIdentity(get(authStore)) !== authIdentity(session)
    || (channel !== undefined && channel !== getActiveChannel());
  try {
    await initChannel();
    if (stale()) return;
    channel = getActiveChannel();
    // Start on the first page (and enqueue the rest as it streams in) so a large
    // playlist begins playing immediately instead of after every page is read.
    let started = false;
    let seen = 0;
    await streamCollectionTracks(playlist.browseId, session, (partial) => {
      if (stale()) return;
      const fresh = partial.slice(seen);
      seen = partial.length;
      if (fresh.length === 0) return;
      if (!started) {
        started = true;
        rememberPlaylist(playlist);
        if (shuffle) void playTracksShuffled(fresh);
        else void playTracks(fresh, 0);
      } else {
        enqueue(fresh);
      }
    });
  } catch (e) {
    if (stale()) return;
    // eslint-disable-next-line no-console
    console.error('[cherry] could not play playlist:', e);
  }
}

// Guards against out-of-order responses: opening playlist A then B quickly must
// not let A's (slower) fetch overwrite B's tracks.
let openSeq = 0;

/** Load the tracks for the playlist currently on screen. */
export async function loadOpenPlaylist(playlist: Playlist, options: { preserveContent?: boolean } = {}): Promise<void> {
  const preserve = options.preserveContent && get(openPlaylistStore)?.browseId === playlist.browseId;
  const id = ++openSeq;
  openPlaylistStore.set(playlist);
  // Clear synchronously so the previous playlist's tracks can never flash under
  // the new header while this load is in flight.
  if (!preserve) {
    openPlaylistTracks.set([]);
    openPlaylistDescription.set(null);
  }
  openPlaylistError.set(null);
  const session = get(authStore);
  if (!session) {
    openPlaylistLoading.set(false);
    openPlaylistError.set('Sign in to open playlists.');
    return;
  }
  openPlaylistLoading.set(!preserve);
  let channel: string | undefined;
  const stale = () => id !== openSeq || authIdentity(get(authStore)) !== authIdentity(session)
    || (channel !== undefined && channel !== getActiveChannel());
  try {
    await initChannel();
    if (stale()) return;
    channel = getActiveChannel();
    // Header metadata (description/art) is independent of the track stream, so
    // fetch it alongside rather than serialising the two.
    void getPlaylistMeta(playlist.browseId, session).then((meta) => {
      if (stale()) return;
      openPlaylistDescription.set(meta?.description ?? null);
      if (meta) patchPlaylist(playlist.browseId, {
        ...(meta.title ? { title: meta.title } : {}),
        ...(meta.thumbnails?.length ? { thumbnails: meta.thumbnails } : {}),
      });
      if (meta?.canEdit) {
        void import('./addablePlaylists').then(({ addablePlaylistsStore, addPlaylistLocally }) => {
          if (!stale() && !get(addablePlaylistsStore).some(item => item.browseId === playlist.browseId)) {
            addPlaylistLocally({ ...playlist, title: meta.title || playlist.title, thumbnails: meta.thumbnails?.length ? meta.thumbnails : playlist.thumbnails });
          }
        });
      }
    });
    const tracks = await streamCollectionTracks(playlist.browseId, session, (partial, done) => {
      if (stale()) return;
      if (preserve && !done) return;
      openPlaylistTracks.set(partial);
      // The first page is enough to render and play; drop the skeleton while
      // the remaining pages keep streaming in.
      if (!done) openPlaylistLoading.set(false);
    });
    if (stale()) return;
    openPlaylistTracks.set(tracks);
    patchPlaylist(playlist.browseId, { trackCount: tracks.length });
    if (tracks.length === 0) {
      openPlaylistError.set('This playlist has no playable tracks.');
    }
  } catch (e) {
    if (stale()) return;
    if (!preserve || !get(openPlaylistTracks).length) openPlaylistError.set(e instanceof Error ? e.message : String(e));
  } finally {
    if (id === openSeq) openPlaylistLoading.set(false);
  }
}

/** Update one playlist without navigating or reloading unrelated lists. */
function patchPlaylist(browseId: string, patch: Partial<Playlist>): void {
  playlistStore.update(list => list.map(item => item.browseId === browseId ? { ...item, ...patch } : item));
  openPlaylistStore.update(item => item?.browseId === browseId ? { ...item, ...patch } : item);
  pageStore.update(page => page.view === 'playlist' && page.entity.browseId === browseId ? { ...page, entity: { ...page.entity, ...patch } } : page);
  homeSectionsStore.update(sections => sections.map(section => ({ ...section, cards: section.cards.map(card => card.browseId === browseId ? { ...card, ...patch } : card) })));
}

const editRefreshes = new Map<string, symbol>();
/** Reconcile a successful add with this playlist's header and visible contents. */
export async function refreshEditedPlaylist(playlist: Playlist, addedTracks: Track[]): Promise<void> {
  const session = get(authStore);
  if (!session) return;
  const channel = getActiveChannel();
  const key = `${authIdentity(session)}::${channel}::${playlist.browseId}`;
  const revision = Symbol('playlist edit');
  editRefreshes.set(key, revision);
  const stale = () => editRefreshes.get(key) !== revision || authIdentity(get(authStore)) !== authIdentity(session) || getActiveChannel() !== channel;
  for (const prefix of ['collection', 'meta']) cacheClear(`${prefix}:${channel}:${playlist.browseId}`);
  cacheClear(`library:${channel}:`);
  const current = get(playlistStore).find(item => item.browseId === playlist.browseId) ?? playlist;
  if (current.trackCount !== undefined) patchPlaylist(playlist.browseId, { trackCount: current.trackCount + addedTracks.length });
  try {
    if (get(openPlaylistStore)?.browseId === playlist.browseId) {
      openPlaylistTracks.update(tracks => [...tracks, ...addedTracks]);
      await loadOpenPlaylist(get(openPlaylistStore)!, { preserveContent: true });
    } else {
      const meta = await getPlaylistMeta(playlist.browseId, session);
      if (!stale() && meta) patchPlaylist(playlist.browseId, {
        ...(meta.title ? { title: meta.title } : {}),
        ...(meta.thumbnails?.length ? { thumbnails: meta.thumbnails } : {}),
      });
    }
  } finally {
    if (editRefreshes.get(key) === revision) editRefreshes.delete(key);
  }
}

// Clear account-owned UI immediately, including sessions restored at startup.
let lastCookie: string | null = null;
authStore.subscribe((session) => {
  const cookie = authIdentity(session);
  if (cookie === lastCookie) return;
  lastCookie = cookie;
  invalidateLoads();
  playlistStore.set([]);
  homeSectionsStore.set([]);
  libraryError.set(null);
  openPlaylistStore.set(null);
  openPlaylistTracks.set([]);
  openPlaylistDescription.set(null);
  openPlaylistError.set(null);
});
