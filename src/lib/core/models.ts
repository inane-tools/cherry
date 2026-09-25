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
  if (ts.length === 0) return '';
  const sorted = [...ts].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((t) => (t.width ?? 0) >= size) ?? sorted[sorted.length - 1]).url;
}
