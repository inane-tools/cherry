// ── Cherry core domain ─────────────────────────────────────────────
// Pure types. No Electron, no Innertube, no DOM imports allowed here.

export type VideoId = string;
export type BrowseId = string;

/** YouTube's rating-backed collections cannot be edited as normal playlists. */
export function isLikedPlaylist(browseId: string): boolean {
  const id = browseId.startsWith('VL') ? browseId.slice(2) : browseId;
  return id === 'LM' || id === 'LL';
}

export interface ArtistRef {
  name: string;
  browseId?: BrowseId;
  /** Present for search/chip results, where YouTube returns an avatar. */
  thumbnails?: Thumbnail[];
}

export interface Thumbnail {
  url: string;
  width?: number;
  height?: number;
}

export interface Track {
  videoId: VideoId;
  /** Identifies one occurrence in its source playlist, not the video itself. */
  playlistEntryId?: string;
  title: string;
  artists: ArtistRef[];
  album?: { name: string; browseId?: BrowseId };
  durationSeconds?: number;
  thumbnails: Thumbnail[];
  /** Set when from the user's library / Premium-only flag */
  isExplicit?: boolean;
  /** Server-issued `MPTC…` browse id for the song's credits, when known. */
  creditsBrowseId?: string;
  isMusicVideo?: boolean;
}

export interface LyricLine { text: string; startSeconds?: number; endSeconds?: number }
export interface Lyrics { lines: LyricLine[]; synced: boolean; source?: string }
export interface RadioEndpoint { videoId?: string; playlistId?: string; params?: string }

export interface Album {
  browseId: BrowseId;
  title: string;
  artists: ArtistRef[];
  year?: string;
  thumbnails: Thumbnail[];
}

export interface Playlist {
  browseId: BrowseId;
  title: string;
  author?: string;
  trackCount?: number;
  thumbnails: Thumbnail[];
}

export interface SearchResults {
  songs: Track[];
  albums: Album[];
  artists: ArtistRef[];
  playlists: Playlist[];
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface QueueItem {
  track: Track;
  /** Zero-based occurrence of this video in the list it was queued from. */
  sourceOccurrence?: number;
  /** stable id for drag-reorder / dedupe */
  queueId: string;
}

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

export interface PlaybackState {
  status: PlaybackStatus;
  track: Track | null;
  positionSeconds: number;
  durationSeconds: number;
  volume: number; // 0..1
  muted: boolean;
  error?: string;
  isLive?: boolean;
}

export interface StreamInfo {
  url: string;
  mimeType: string;
  /** Optional HD adaptive stream; url remains the progressive fallback. */
  dashManifest?: string;
  bitrate?: number;
  isLive?: boolean;
  /** expiry hint for refresh */
  expiresInSeconds?: number;
}

/** YouTube Music web session: the raw `Cookie` header from music.youtube.com
 *  (captured automatically from the embedded login window, or pasted). */
export interface AuthSession {
  /** Google account slot from the login page, distinct from a brand page ID. */
  accountIndex?: number;
  selectedChannelId?: string;
  /** No secure OS storage: this sign-in lasts until the app exits. */
  persistence?: 'memory';
  kind: 'cookie';
  cookie: string;
  accountLabel?: string;
  savedAt: number;
}

/** Legacy playlist pins remain valid without an explicit kind. */
export interface PinnedPlaylist {
  kind?: 'playlist';
  browseId: BrowseId;
  title: string;
  thumbnail?: string;
}

export type SidebarPin = PinnedPlaylist
  | { kind: 'album'; browseId: string; title: string; thumbnail?: string; album: Album }
  | { kind: 'artist'; browseId: string; title: string; thumbnail?: string; artist: ArtistRef }
  | { kind: 'song'; browseId: string; title: string; thumbnail?: string; track: Track };

export function isPlaylistPin(pin: SidebarPin): pin is PinnedPlaylist {
  return !pin.kind || pin.kind === 'playlist';
}

/** A user-created folder that groups playlists in the sidebar. */
export interface PlaylistFolder {
  id: string;
  name: string;
  playlistIds: BrowseId[];
}

export type AppView = 'home' | 'explore' | 'search' | 'playlist' | 'artist' | 'album' | 'settings';

/** Signed-in YouTube identity (a brand channel, not the raw Google account). */
export interface AccountProfile {
  name: string;
  handle?: string;
  avatarUrl?: string;
  /** Brand-channel page id used as the request context. */
  pageId?: string;
  /** True for real channels; the account-level row has no library. */
  isChannel?: boolean;
  isSelected?: boolean;
  /** Legacy: number of channels on the account. */
  channels?: number;
}

export function trackDisplayArtists(t: Pick<Track, 'artists'>): string {
  return t.artists.map((a) => a.name).join(', ') || 'Unknown artist';
}

export function bestThumbnail(ts: Thumbnail[], size = 256): string {
  let best: Thumbnail | undefined;
  let largest: Thumbnail | undefined;
  for (const thumbnail of ts) {
    const width = thumbnail.width ?? 0;
    if (!largest || width >= (largest.width ?? 0)) largest = thumbnail;
    if (width >= size && (!best || width < (best.width ?? 0))) best = thumbnail;
  }
  return (best ?? largest)?.url ?? '';
}

/** Preferred artwork followed by the other supplied sizes as fallbacks. */
export function thumbnailSources(ts: Thumbnail[], size = 256): string[] {
  const supplied = bestThumbnail(ts, size);
  // Google artwork URLs explicitly support dimensions. Avoid decoding a 544px
  // image for a 40–48px row when no smaller variant was supplied by the API.
  const sized = /^https:\/\/[^/]+\.(?:googleusercontent\.com|ggpht\.com)\//i.test(supplied)
    ? supplied.replace(/=w(\d+)-h(\d+)/, (match, width, height) => Number(width) > size && Number(height) > size ? `=w${Math.ceil(size)}-h${Math.ceil(size)}` : match)
    : supplied;
  return [...new Set([
    sized, supplied,
    ...[...ts].sort((a, b) => (b.width ?? 0) - (a.width ?? 0)).map((t) => t.url),
  ].filter(Boolean))];
}

/**
 * Upgrade a YouTube / Google thumbnail URL to a larger size.
 *
 * Track artwork is usually fetched small (`hqdefault.jpg` or `=w226-h226`), which
 * looks poor scaled up as the full-screen player background. YouTube still serves
 * `maxresdefault.jpg`, and Google's CDN honours a larger `=w…-h…`, so rewrite to
 * the big variant. Callers should keep the original as an `onerror` fallback: not
 * every video has a `maxresdefault`.
 */
export function hiResThumbnail(url: string, size = 1080): string {
  if (!url) return url;
  // i.ytimg.com/vi/<id>/<name>.jpg  →  maxresdefault.jpg
  const ytimg = url.match(/^(https?:\/\/i\.ytimg\.com\/(?:vi|vi_webp)\/[^/]+\/)[^/?#]+/);
  if (ytimg) return `${ytimg[1]}maxresdefault.${ytimg[1].includes('/vi_webp/') ? 'webp' : 'jpg'}${url.slice(ytimg[0].length)}`;
  // Google CDN: =w544-h544-l90-rj  →  =w1080-h1080-l90-rj
  if (/=w\d+-h\d+/.test(url)) return url.replace(/=w\d+-h\d+/, `=w${size}-h${size}`);
  return url;
}

/** Keep maximum resolution first, then try real intermediate YouTube sizes. */
export function expandedArtworkSources(ts: Thumbnail[], size = 1080): string[] {
  const supplied = thumbnailSources(ts, 512);
  const largest = hiResThumbnail(supplied[0] ?? '', size);
  const youtube = largest.match(/^(https?:\/\/i\.ytimg\.com\/(?:vi|vi_webp)\/[^/]+\/)maxresdefault\.(jpg|webp)(.*)$/);
  return [...new Set([
    largest,
    ...(youtube ? ['sddefault', 'hqdefault'].map(name => `${youtube[1]}${name}.${youtube[2]}${youtube[3]}`) : []),
    ...supplied,
  ].filter(Boolean))];
}
