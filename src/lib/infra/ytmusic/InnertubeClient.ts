// ── Innertube client (YouTube Music, unofficial) ────────────────────
// Strategy "B": 100% custom frontend talking to YouTube Music's internal
// Innertube API via youtubei.js.
//
// Notes / trade-offs (be honest with users):
// - No official YT Music API exists; this uses the same internal endpoints
//   the web client uses. Google changes them occasionally → keep
//   `youtubei.js` pinned and update promptly when playback breaks.
// - Auth is the user's real music.youtube.com session cookie: captured
//   automatically from the embedded login window (Settings → "Continue with
//   YouTube Music") or pasted manually. Stored in the OS keychain.
//   Anonymous mode works for search; anonymous *playback* falls back to
//   TV/ANDROID player clients when YouTube bot-walls the WEB client.
// - In Tauri, youtubei.js traffic relays through Rust (CORS-free); the
//   Cookie header rides along like any other header.
// - All raw-API access stays in this file + mappers.ts. Services/UI only
//   see stable core models.

import { Innertube, Platform } from 'youtubei.js';
import type {
  AccountProfile,
  Album,
  ArtistRef,
  AuthSession,
  Playlist,
  SearchResults,
  StreamInfo,
  Thumbnail,
  Track,
} from '$lib/core/models';
import { CherryError } from '$lib/core/errors';
import { cached } from '$lib/infra/storage/cache';
import { mapAlbum, mapArtistRef, mapCardShelf, mapPlaylist, mapTrack } from './mappers';
import { scanLibrary } from './rawLibrary';
import { scanHome, scanPageHeader, type HomeSection } from './rawHome';
import { innertubeFetch } from './tauriFetch';
import { installEvaluator } from './evaluator';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInnertube = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

/** Cache lifetimes (ms). Playlists change rarely; feeds and search don't. */
const TTL = {
  playlist: 30 * 60_000,
  home: 3 * 60_000,
  search: 2 * 60_000,
  channels: 60 * 60_000,
} as const;

/**
 * Persistent youtubei.js cache (IndexedDB in the webview).
 *
 * Without it every client creation re-downloads the session config and the
 * multi-megabyte player JS. With it those are fetched once and reused across
 * restarts — the single biggest request/startup saving.
 */
let ytCache: unknown | null = null;
let ytCacheResolved = false;

function getYtCache(): unknown | undefined {
  if (ytCacheResolved) return ytCache ?? undefined;
  ytCacheResolved = true;
  try {
    const ctor = (Platform.shim as unknown as {
      Cache?: new (persistent?: boolean, dir?: string) => unknown;
    }).Cache;
    if (ctor) ytCache = new ctor(true, 'cherry-youtubei');
  } catch {
    ytCache = null;
  }
  return ytCache ?? undefined;
}

// Clients keyed by (cookie, channel, player) so a browse-only client and a
// player-capable client coexist instead of evicting each other.
const CLIENTS = new Map<string, Promise<AnyInnertube>>();
const CLIENT_MAX = 3;

/**
 * Brand-channel ("page id") the session should act as.
 *
 * A single Google login can own several channels, and the YouTube Music
 * library, home feed and recommendations are **per channel**. Without this the
 * API answers for the personal account, which can look completely empty even
 * when the user has many playlists. Discovered live: switching this id took
 * the playlist count from 2 to 26 on a real account.
 */
let activeChannelPageId = '';

export function setActiveChannel(pageId: string | null | undefined): void {
  const next = pageId ?? '';
  if (next === activeChannelPageId) return;
  activeChannelPageId = next;
  // Clients are channel-specific; cached *responses* are keyed by channel too,
  // so they are left alone (and are still valid if the user switches back).
  resetInnertubeClient();
}

export function getActiveChannel(): string {
  return activeChannelPageId;
}

export interface InnertubeOptions {
  /** Fetch the player JS so streams can be deciphered. Skip it for listing
   *  endpoints: it is by far the slowest part of session creation. */
  retrievePlayer?: boolean;
  /** Use a channel other than the active one for this client only, without
   *  disturbing global state (used to enumerate channels). */
  channel?: string;
}

function cacheKey(
  session: AuthSession | null | undefined,
  retrievePlayer: boolean,
  channel: string,
): string {
  return `${session?.cookie ?? ''}::${channel}::${retrievePlayer ? 'p' : 'np'}`;
}

export function resetInnertubeClient(): void {
  CLIENTS.clear();
}

export async function getInnertube(
  session?: AuthSession | null,
  options: InnertubeOptions = {},
): Promise<AnyInnertube> {
  const retrievePlayer = options.retrievePlayer === true;
  const channel = options.channel ?? activeChannelPageId;
  const key = cacheKey(session, retrievePlayer, channel);
  const existing = CLIENTS.get(key);
  if (existing) {
    // Refresh LRU position.
    CLIENTS.delete(key);
    CLIENTS.set(key, existing);
    return existing;
  }

  const promise = (async () => {
    try {
      installEvaluator();
      // `cookie` authenticates every request (incl. SAPISIDHASH). Empty =
      // anonymous. `on_behalf_of_user` selects the brand channel to act as.
      const client = (await Innertube.create({
        lang: 'en',
        location: 'GB',
        cookie: session?.cookie,
        retrieve_player: retrievePlayer,
        ...(channel ? { on_behalf_of_user: channel } : {}),
        // In Tauri, direct fetch() to Google is CORS-blocked in the webview;
        // relay through Rust (reqwest). No-op outside Tauri.
        fetch: innertubeFetch(),
        cache: getYtCache(),
      } as never)) as AnyInnertube;
      return client;
    } catch (e) {
      CLIENTS.delete(key);
      if (e instanceof CherryError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      // eslint-disable-next-line no-console
      console.error('[cherry] innertube session failed:', e);
      if (/auth|token|revok|login|401|403/i.test(msg)) {
        throw new CherryError('auth-invalid', 'Session expired. Please sign in again.', e);
      }
      const cause = msg.length > 160 ? `${msg.slice(0, 160)}…` : msg;
      throw new CherryError(
        'network',
        `Could not reach YouTube Music. Check your connection. (${cause})`,
        e,
      );
    }
  })();

  CLIENTS.set(key, promise);
  while (CLIENTS.size > CLIENT_MAX) {
    const oldest = CLIENTS.keys().next().value;
    if (oldest === undefined) break;
    CLIENTS.delete(oldest);
  }
  return promise;
}

/** Pick the best audio-only stream and resolve its final URL.
 *  Prefers the (possibly logged-in) WEB client for best/Premium quality.
 *  Reality check (probed live): YouTube currently withholds direct URLs from
 *  audio-only formats unless the request carries a PO token — even authed.
 *  Progressive (muxed) formats still carry URLs, so they are the fallback:
 *  audio-only first, then known audio-bearing progressive itags. */
const PROGRESSIVE_WITH_AUDIO = new Set([17, 18, 22, 36, 43]);

export async function getAudioStream(
  videoId: string,
  session?: AuthSession | null,
): Promise<{ track: { durationSeconds?: number }; stream: StreamInfo }> {
  // Playback is the one place the player JS is genuinely required, so this is
  // the only call that opts into fetching it.
  const client = await getInnertube(session, { retrievePlayer: true });
  let lastError: unknown;
  // `undefined` = default WEB client (authed when logged in). YTMUSIC is the
  // music.youtube.com client itself — best odds of audio URLs when authed.
  const attempts: (string | undefined)[] = [undefined, 'YTMUSIC', 'TV', 'ANDROID'];
  for (const playerClient of attempts) {
    let info: AnyNode;
    try {
      info = playerClient
        ? await client.getInfo(videoId, { client: playerClient })
        : await client.getInfo(videoId);
    } catch (e) {
      lastError = e;
      continue;
    }
    if (info.playability_status?.status !== 'OK' || !info.streaming_data) continue;
    const usable = (f: AnyNode) => f?.url || f?.signature_cipher || f?.cipher;
    const pool: AnyNode[] = [
      ...(info.streaming_data.adaptive_formats ?? []),
      ...(info.streaming_data.formats ?? []),
    ].filter(usable);
    const byBitrate = (a: AnyNode, b: AnyNode) => (b?.bitrate ?? 0) - (a?.bitrate ?? 0);
    // Prefer direct progressive URLs. YouTube frequently returns signed
    // adaptive audio URLs that decipher correctly but are rejected when the
    // HTMLAudioElement requests them. Progressive itag 18 is less fancy but
    // much more reliable across logged-in WebView2 sessions.
    const progressive = pool
      .filter((f) => PROGRESSIVE_WITH_AUDIO.has(Number(f?.itag)))
      .sort(byBitrate);
    const audio = pool.filter((f) => /audio/i.test(f?.mime_type ?? '')).sort(byBitrate);
    const ranked = [...progressive, ...audio];
    for (const format of ranked.slice(0, 12)) {
      // ALWAYS run decipher, even when a plain `url` exists.
      //
      // Measured against a real library (12/12 tracks): using `format.url`
      // verbatim failed with HTTP 403 for every URL that carried YouTube's
      // `n` throttling parameter, while the deciphered URL returned 206. The
      // `n` transform happens inside decipher, so the "direct url" shortcut
      // was silently breaking a sizable share of tracks.
      let url = '';
      try {
        url = String((await format.decipher(client.session.player)) ?? '');
      } catch {
        url = '';
      }
      if (!url && format.url) url = String(format.url);
      if (!url) continue;
      return {
        track: { durationSeconds: info.basic_info?.duration },
        stream: {
          url,
          mimeType: String(format.mime_type ?? 'audio/mp4'),
          bitrate: format.bitrate,
        },
      };
    }
  }
  throw new CherryError(
    'stream-unavailable',
    session?.cookie
      ? 'This track is unavailable (region / age restriction?).'
      : 'Playback needs a login right now — sign in with your Premium account.',
    lastError,
  );
}

function walkMusicShelves(contents: AnyNode[]): AnyNode[] {
  const items: AnyNode[] = [];
  for (const entry of contents ?? []) {
    if (!entry) continue;
    if (entry.type === 'ItemSection' || entry.type === 'MusicShelf') {
      for (const it of entry.contents ?? []) if (it) items.push(it);
    } else if (entry.type === 'MusicCardShelf') {
      items.push(entry);
    }
  }
  return items;
}

/** Resolve to `null` if `promise` does not settle within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(null);
    }, ms);
    promise.then(
      (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * Find a search result shelf by (lower-cased) title. Matching on the title is
 * more reliable than youtubei.js' typed getters, which look for specific names
 * like "Community playlists".
 */
function findShelf(search: AnyNode, test: (title: string) => boolean): AnyNode | undefined {
  const shelves: AnyNode[] = (search?.contents ?? []).filter(
    (entry: AnyNode) => entry?.type === 'MusicShelf',
  );
  return shelves.find((shelf) => test(String(shelf?.title ?? '').toLowerCase()));
}

/**
 * Load the next page of a shelf ("Show more"), as a best-effort extra: a shelf
 * without an endpoint, a failure, or a slow request contributes nothing rather
 * than failing the whole search.
 */
async function expandShelf(search: AnyNode, shelf: AnyNode | undefined): Promise<AnyNode[]> {
  if (!shelf) return [];
  try {
    const more = await withTimeout(search.getMore(shelf) as Promise<AnyNode>, 8000);
    if (!more) return [];
    return walkMusicShelves(more.contents ?? []);
  } catch {
    return [];
  }
}

export async function searchAll(query: string, session?: AuthSession | null): Promise<SearchResults> {
  const q = query.trim();
  if (!q) return { songs: [], albums: [], artists: [], playlists: [] };
  // Search is the most repeated request in the app; cache it briefly.
  return cached(`search:${q.toLowerCase()}`, TTL.search, () => runSearch(q, session));
}

async function runSearch(q: string, session?: AuthSession | null): Promise<SearchResults> {
  const client = await getInnertube(session, { retrievePlayer: false });
  try {
    const res = await client.music.search(q, { type: 'all' });
    const songs: Track[] = [];
    const albums: Album[] = [];
    const artists: ArtistRef[] = [];
    const playlists: Playlist[] = [];
    const seenSongs = new Set<string>();
    const seenRest = new Set<string>();

    const pushRow = (item: AnyNode) => {
      if (!item || typeof item !== 'object') return;
      const kind = item.item_type as string | undefined;
      if (item.type === 'MusicCardShelf') {
        const t = mapCardShelf(item);
        if (t && !seenSongs.has(t.videoId)) {
          seenSongs.add(t.videoId);
          songs.unshift(t); // top result first
        }
        return;
      }
      if (kind === 'song' || kind === 'video' || (!kind && (item.video_id || item.endpoint?.name === 'watchEndpoint'))) {
        const t = mapTrack(item);
        if (t && !seenSongs.has(t.videoId)) {
          seenSongs.add(t.videoId);
          songs.push(t);
        }
      } else if (kind === 'album') {
        const a = mapAlbum(item);
        if (a && !seenRest.has(a.browseId)) {
          seenRest.add(a.browseId);
          albums.push(a);
        }
      } else if (kind === 'artist') {
        const a = mapArtistRef(item);
        if (a && a.browseId && !seenRest.has(a.browseId)) {
          seenRest.add(a.browseId);
          artists.push(a);
        }
      } else if (kind === 'playlist' || kind === 'podcast') {
        const p = mapPlaylist(item);
        if (p && !seenRest.has(p.browseId)) {
          seenRest.add(p.browseId);
          playlists.push(p);
        }
      } else {
        // Unknown row: best-effort track mapping (covers legacy shelves).
        const t = mapTrack(item);
        if (t && !seenSongs.has(t.videoId)) {
          seenSongs.add(t.videoId);
          songs.push(t);
        }
      }
    };

    for (const item of walkMusicShelves(res.contents ?? [])) pushRow(item);
    // Legacy parsed shelves (older youtubei.js / responses) — keep as fallback.
    for (const item of res.songs?.contents ?? []) pushRow({ ...item, item_type: 'song' });
    for (const item of res.albums?.contents ?? []) pushRow({ ...item, item_type: 'album' });
    for (const item of res.playlists?.contents ?? []) pushRow({ ...item, item_type: 'playlist' });
    for (const item of res.artists?.contents ?? []) {
      const a = mapArtistRef(item);
      if (a && a.browseId && !seenRest.has(a.browseId)) {
        seenRest.add(a.browseId);
        artists.push(a);
      }
    }

    // The first page only holds ~20 rows per shelf. Ask for the next page of
    // each in parallel so a search surfaces more of what YouTube actually has;
    // any shelf without a continuation simply adds nothing.
    const expanded = await Promise.all([
      expandShelf(res, findShelf(res, (t) => t === 'songs')),
      expandShelf(res, findShelf(res, (t) => t === 'albums')),
      expandShelf(res, findShelf(res, (t) => t === 'artists')),
      expandShelf(res, findShelf(res, (t) => /playlist/.test(t))),
    ]);
    for (const items of expanded) {
      for (const item of items) pushRow(item);
    }

    return {
      songs: songs.slice(0, 60),
      albums: albums.slice(0, 30),
      artists: artists.slice(0, 20),
      playlists: playlists.slice(0, 30),
    };
  } catch (e) {
    if (e instanceof CherryError) throw e;
    throw new CherryError('network', 'Search failed. Try again in a moment.', e);
  }
}

export async function searchSongs(query: string, session?: AuthSession | null): Promise<Track[]> {
  return (await searchAll(query, session)).songs;
}

/** Load the signed-in user's playlists for the left navigation rail.
 *
 *  Two things matter here:
 *  1. `music.getLibrary()` throws on `ItemSection` nodes (it asserts every
 *     child is Grid|MusicShelf), so we scan the raw browse response instead.
 *  2. `FEmusic_library_landing` is a *landing page* (shelves + shortcuts), not
 *     the playlists list. The actual list lives at `FEmusic_liked_playlists`;
 *     the landing page is kept only as a fallback. */
const LIBRARY_PLAYLIST_BROWSE_IDS = ['FEmusic_liked_playlists', 'FEmusic_library_landing'];

export async function getLibraryPlaylists(session: AuthSession): Promise<Playlist[]> {
  // Cached (and persisted) so the playlist rail survives a restart instead of
  // coming back empty until the network answers again. Only non-empty lists
  // are cached: an empty result is either a genuine empty library or a failed
  // read, and caching it would make the rail look permanently broken.
  return cached(
    `library:${getActiveChannel()}:${sessionKey(session)}`,
    TTL.playlist,
    () => runLibraryPlaylists(session),
    { shouldCache: (value) => value.length > 0 },
  );
}

async function runLibraryPlaylists(session: AuthSession): Promise<Playlist[]> {
  const client = await getInnertube(session, { retrievePlayer: false });
  const collected = new Map<string, Playlist>();
  const rendererCounts: Record<string, number> = {};
  let errors: string[] = [];

  for (const browseId of LIBRARY_PLAYLIST_BROWSE_IDS) {
    if (collected.size > 0) break;
    let continuation: string | undefined;
    for (let page = 0; page < 5; page++) {
      let scan;
      try {
        const response: AnyNode = await client.actions.execute('/browse', {
          ...(continuation ? { continuation } : { browseId }),
          client: 'YTMUSIC',
        });
        const raw = response?.data;
        if (!raw) break;
        scan = scanLibrary(raw);
      } catch (e) {
        errors.push(`${browseId}: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
      for (const [key, count] of Object.entries(scan.rendererCounts)) {
        rendererCounts[key] = (rendererCounts[key] ?? 0) + count;
      }
      for (const playlist of scan.playlists) {
        if (!collected.has(playlist.browseId)) collected.set(playlist.browseId, playlist);
      }
      if (!scan.continuation) break;
      continuation = scan.continuation;
    }
  }

  // Distinguish "genuinely empty library" from "the response shape changed":
  // if playlist rows were present but none mapped, surface that instead of
  // silently claiming the account has no playlists.
  if (collected.size === 0) {
    const rowsPresent =
      (rendererCounts.musicTwoRowItemRenderer ?? 0) +
      (rendererCounts.musicResponsiveListItemRenderer ?? 0);
    if (rowsPresent > 0) {
      const seen = Object.keys(rendererCounts).sort().slice(0, 12).join(', ');
      throw new CherryError(
        'not-found',
        `Could not read the playlist list (rows: ${rowsPresent}; renderers: ${seen}).`,
      );
    }
    if (errors.length > 0) {
      throw new CherryError('network', `Playlist request failed — ${errors[0]}`);
    }
  }

  return [...collected.values()];
}

/** Real account identity + avatar for the top bar (cookie sessions only). */
export async function getAccountProfile(session: AuthSession): Promise<AccountProfile | null> {
  const channels = await getChannels(session);
  const active = channels.find((c) => c.pageId === getActiveChannel());
  return active ?? channels[0] ?? null;
}

/**
 * All channels (brand accounts) reachable by this session, each with its own
 * YouTube Music library. The top bar avatar and the playlist rail both depend
 * on picking the *channel* entry — the account-level row has no channel and
 * an empty library.
 */
/** Non-reversible key for a session, so caches don't store the cookie itself. */
function sessionKey(session?: AuthSession | null): string {
  const cookie = session?.cookie ?? '';
  let hash = 5381;
  for (let i = 0; i < cookie.length; i++) {
    hash = ((hash << 5) + hash + cookie.charCodeAt(i)) | 0;
  }
  return `${cookie.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

export async function getChannels(session: AuthSession): Promise<AccountProfile[]> {
  // Never persist (a stale channel list is exactly what made login look like it
  // had silently failed) and never cache an empty result.
  return cached(`channels:${sessionKey(session)}`, TTL.channels, () => runGetChannels(session), {
    persist: false,
    shouldCache: (list) => list.length > 0,
  });
}

async function runGetChannels(session: AuthSession): Promise<AccountProfile[]> {
  // Enumerate with an empty channel context, without touching global state.
  // Errors propagate so the result is not cached (callers retry).
  const client = await getInnertube(session, { retrievePlayer: false, channel: '' });
  const items: AnyNode[] = (await client.account.getInfo(true)) ?? [];
  if (!Array.isArray(items)) return [];
  const profiles: AccountProfile[] = [];
  for (const item of items) {
    const name = item?.account_name?.text ?? item?.account_name ?? null;
    if (!name) continue;
    const handle = item?.channel_handle?.text ?? item?.channel_handle ?? null;
    const photos: AnyNode[] = item?.account_photo ?? [];
    const sorted = [...photos].sort((a, b) => (a?.width ?? 0) - (b?.width ?? 0));
    const avatarUrl = sorted.length > 0 ? String(sorted[sorted.length - 1]?.url ?? '') : '';
    // The page id lives in the identity-switch token.
    const tokens: AnyNode[] = item?.endpoint?.payload?.supportedTokens ?? [];
    const pageId: string | undefined = tokens
      .map((t) => t?.pageIdToken?.pageId)
      .find((id) => typeof id === 'string');
    profiles.push({
      name: String(name),
      handle: handle ? String(handle) : undefined,
      avatarUrl: avatarUrl || undefined,
      pageId,
      isChannel: Boolean(item?.has_channel),
      isSelected: Boolean(item?.is_selected),
    });
  }
  return profiles;
}

/**
 * Pick the channel that actually holds a library.
 *
 * A login can own many channels and YouTube defaults to the personal account,
 * which may be empty even when the user has plenty of playlists. We probe each
 * channel and choose the richest, so the app opens on the user's real library
 * instead of an empty one.
 */
export async function pickPrimaryChannel(session: AuthSession): Promise<AccountProfile | null> {
  const channels = (await getChannels(session)).filter((c) => c.isChannel && c.pageId);
  if (channels.length === 0) return null;

  // Probe each channel with a one-off client rather than mutating the global
  // context, so nothing else sees a half-switched state.
  const scored = await Promise.all(
    channels.map(async (channel) => {
      const pageId = channel.pageId ?? '';
      return cached(
        `probe:${sessionKey(session)}:${pageId}`,
        TTL.playlist,
        async () => {
          try {
            // Listing only: no player JS needed, which keeps probing fast.
            const client = await getInnertube(session, { retrievePlayer: false, channel: pageId });
            const response: AnyNode = await client.actions.execute('/browse', {
              browseId: 'FEmusic_liked_playlists',
              client: 'YTMUSIC',
            });
            const scan = scanLibrary(response?.data);
            return { channel, count: scan.playlists.length };
          } catch {
            return { channel, count: 0 };
          }
        },
        // A zero count can just be a transient failure — don't remember it.
        { persist: false, shouldCache: (result) => result.count > 0 },
      );
    }),
  );

  scored.sort((a, b) => b.count - a.count);
  return scored[0]?.channel ?? channels[0];
}

/** The real YouTube Music home feed: carousel shelves of cards and songs. */
export async function getHomeSections(session?: AuthSession | null): Promise<HomeSection[]> {
  return cached(`home:${getActiveChannel()}`, TTL.home, () => runHomeSections(session));
}

async function runHomeSections(session?: AuthSession | null): Promise<HomeSection[]> {
  const client = await getInnertube(session, { retrievePlayer: false });
  const response: AnyNode = await client.actions.execute('/browse', {
    browseId: 'FEmusic_home',
    client: 'YTMUSIC',
  });
  return scanHome(response?.data);
}

/** Browse a `FEmusic_*` page and return its shelves (used by Explore). */
async function runBrowseSections(
  browseId: string,
  session?: AuthSession | null,
): Promise<HomeSection[]> {
  const client = await getInnertube(session, { retrievePlayer: false });
  const response: AnyNode = await client.actions.execute('/browse', {
    browseId,
    client: 'YTMUSIC',
  });
  return scanHome(response?.data);
}

/** Moods & genres / new releases etc. — the YouTube Music "Explore" page. */
export async function getExploreSections(session?: AuthSession | null): Promise<HomeSection[]> {
  return cached(`explore:${getActiveChannel()}`, TTL.home, () =>
    runBrowseSections('FEmusic_explore', session),
  );
}

export interface ArtistPage {
  title: string;
  subtitle?: string;
  description?: string;
  thumbnails: Thumbnail[];
  sections: HomeSection[];
}

export async function getArtistPage(
  browseId: string,
  session?: AuthSession | null,
): Promise<ArtistPage> {
  return cached(`artist:${getActiveChannel()}:${browseId}`, TTL.playlist, async () => {
    const client = await getInnertube(session, { retrievePlayer: false });
    const response: AnyNode = await client.actions.execute('/browse', {
      browseId,
      client: 'YTMUSIC',
    });
    const raw = response?.data;
    const header = scanPageHeader(raw);
    return {
      title: header?.title ?? '',
      subtitle: header?.subtitle,
      description: header?.description,
      thumbnails: header?.thumbnails ?? [],
      sections: scanHome(raw),
    };
  });
}

export interface AlbumPage {
  title: string;
  subtitle?: string;
  description?: string;
  thumbnails: Thumbnail[];
  /** Album artist (from the detail header's `author`). */
  artists: ArtistRef[];
  year?: string;
  tracks: Track[];
}

export async function getAlbumPage(
  browseId: string,
  session?: AuthSession | null,
): Promise<AlbumPage> {
  return cached(`album:${getActiveChannel()}:${browseId}`, TTL.playlist, async () => {
    const client = await getInnertube(session, { retrievePlayer: false });
    // Raw browse for a robust header/cover, typed album for artist + year.
    const response: AnyNode = await client.actions.execute('/browse', {
      browseId,
      client: 'YTMUSIC',
    });
    const header = scanPageHeader(response?.data);

    let artist: ArtistRef | undefined;
    let year: string | undefined;
    let tracks: Track[] = [];
    try {
      const album = await client.music.getAlbum(browseId);
      const info: AnyNode = album?.header;
      const author = info?.author;
      if (author?.name) {
        artist = {
          name: String(author.name),
          browseId: author.channel_id ? String(author.channel_id) : undefined,
        };
      }
      if (info?.year) year = String(info.year);
      const rows = await loadAllRows(album);
      tracks = rows
        .map((row) => mapTrack(row))
        .filter((track: Track | null): track is Track => Boolean(track));
    } catch (e) {
      // The typed parser can throw on unexpected nodes; fall back.
      // eslint-disable-next-line no-console
      console.warn('[cherry] typed album failed, using generic expander', e);
      tracks = await getCollectionTracks(browseId, session);
    }

    const art = header?.thumbnails ?? [];
    const meta = (header?.subtitle ?? '')
      .split('•')
      .map((s) => s.trim())
      .filter(Boolean);
    const albumYear = year ?? meta.find((s) => /^(19|20)\d{2}$/.test(s));

    // Individual album tracks carry neither artwork nor artists: borrow both.
    const filled = tracks.map((track) => {
      const withArt =
        art.length > 0 && track.thumbnails.length === 0 ? { ...track, thumbnails: art } : track;
      return withArt.artists.length === 0 && artist
        ? { ...withArt, artists: [artist] }
        : withArt;
    });

    return {
      title: header?.title ?? '',
      subtitle: header?.subtitle,
      description: header?.description,
      thumbnails: art,
      artists: artist ? [artist] : [],
      year: albumYear,
      tracks: filled,
    };
  });
}

/**
 * Tracks of an album or playlist, for playing a home-feed card.
 * Returns an empty list rather than throwing: a card that cannot be expanded
 * should not break the page.
 *
 * YouTube returns playlists one page (~100) at a time, so continuations are
 * followed until exhausted — otherwise long playlists were silently truncated
 * to their first hundred tracks. Measured on a large public playlist: 10 pages,
 * 1067 tracks.
 */
async function loadAllRows(container: AnyNode): Promise<AnyNode[]> {
  const rows: AnyNode[] = [...(container?.contents ?? container?.items ?? [])];
  let current = container;
  // Guard against a runaway continuation loop.
  for (let page = 0; page < 200 && current?.has_continuation; page++) {
    try {
      current = await current.getContinuation();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[cherry] playlist continuation failed; keeping loaded tracks', e);
      break;
    }
    const next: AnyNode[] = current?.contents ?? current?.items ?? [];
    if (next.length === 0) break;
    rows.push(...next);
  }
  return rows;
}

export async function getCollectionTracks(
  browseId: string,
  session?: AuthSession | null,
): Promise<Track[]> {
  // Playlists are the expensive ones (one request per ~100 tracks), so they get
  // the longest TTL and are persisted for instant re-opens.
  return cached(`collection:${getActiveChannel()}:${browseId}`, TTL.playlist, () =>
    runCollectionTracks(browseId, session),
  );
}

async function runCollectionTracks(
  browseId: string,
  session?: AuthSession | null,
): Promise<Track[]> {
  const client = await getInnertube(session, { retrievePlayer: false });
  try {
    const isAlbum = browseId.startsWith('MPR') || browseId.startsWith('FEmusic_library_privately_owned_release');
    const container = isAlbum
      ? await client.music.getAlbum(browseId)
      : await client.music.getPlaylist(browseId);
    const rows = await loadAllRows(container);
    const tracks: Track[] = [];
    for (const row of rows) {
      const track = mapTrack(row);
      if (track) tracks.push(track);
    }
    return tracks;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cherry] could not expand collection', browseId, e);
    return [];
  }
}

/** "Up next" autoplay recommendations for radio mode. */
export async function getUpNext(videoId: string, session?: AuthSession | null): Promise<Track[]> {
  const client = await getInnertube(session);
  try {
    const info = await client.getInfo(videoId);
    const results = info.watch_next_feed ?? info.watch_next?.contents ?? [];
    const out: Track[] = [];
    for (const item of results) {
      const t = mapTrack(item);
      if (t && t.videoId !== videoId) out.push(t);
      if (out.length >= 25) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Home feed (quick picks) for logged-in users; empty anonymously. */
export async function getHomeFeed(session?: AuthSession | null): Promise<Track[]> {
  if (!session?.cookie) return [];
  const client = await getInnertube(session);
  try {
    const home = await client.music.getHomeFeed();
    const out: Track[] = [];
    const seen = new Set<string>();
    for (const section of home.sections ?? home.contents ?? []) {
      for (const item of section?.contents ?? []) {
        const t = mapTrack(item);
        if (t && !seen.has(t.videoId)) {
          seen.add(t.videoId);
          out.push(t);
        }
      }
    }
    return out.slice(0, 30);
  } catch {
    return [];
  }
}
