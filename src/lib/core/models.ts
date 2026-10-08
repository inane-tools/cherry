// ── Cherry core domain ─────────────────────────────────────────────
// Pure types. No Tauri, no Innertube, no DOM imports allowed here.

export type VideoId = string;
export type BrowseId = string;

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
  title: string;
  artists: ArtistRef[];
  album?: { name: string; browseId?: BrowseId };
  durationSeconds?: number;
  thumbnails: Thumbnail[];
  /** Set when from the user's library / Premium-only flag */
  isExplicit?: boolean;
}

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
}

export interface StreamInfo {
  url: string;
  mimeType: string;
  bitrate?: number;
  /** expiry hint for refresh */
  expiresInSeconds?: number;
}

/** YouTube Music web session: the raw `Cookie` header from music.youtube.com
 *  (captured automatically from the embedded login window, or pasted). */
export interface AuthSession {
  kind: 'cookie';
  cookie: string;
  accountLabel?: string;
  savedAt: number;
}

/** A playlist pinned to the top bar for quick access. */
export interface PinnedPlaylist {
  browseId: BrowseId;
  title: string;
  thumbnail?: string;
}

/** A user-created folder that groups playlists in the sidebar. */
export interface PlaylistFolder {
  id: string;
  name: string;
  playlistIds: BrowseId[];
}

export type AppView = 'home' | 'search' | 'playlist' | 'artist' | 'album' | 'settings';

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
  if (ts.length === 0) return '';
  const sorted = [...ts].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((t) => (t.width ?? 0) >= size) ?? sorted[sorted.length - 1]).url;
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
  if (ytimg) return `${ytimg[1]}maxresdefault.jpg${url.slice(ytimg[0].length)}`;
  // Google CDN: =w544-h544-l90-rj  →  =w1080-h1080-l90-rj
  if (/=w\d+-h\d+/.test(url)) return url.replace(/=w\d+-h\d+/, `=w${size}-h${size}`);
  return url;
}
