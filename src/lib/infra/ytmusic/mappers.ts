// Maps raw youtubei.js nodes → Cherry core models.
// youtubei.js internals change often; keep all defensive access here so
// the rest of the app only deals with stable `Track`/`Album` shapes.
//
// Shapes handled (Sept 2026):
// - MusicResponsiveListItem (current music.search rows): `item_type`
//   ('song'|'video'|'album'|'artist'|'playlist'), `id` (videoId for
//   song/video, browseId otherwise), plain-string `title`, `artists[]`,
//   `thumbnail.contents[]`.
// - MusicCardShelf: the "top result" card.
// - Legacy: CompactVideo/Video (video_id, title Text, author) and older
//   music shelves. Kept as fallback for up-next/home feeds.

import type { Album, ArtistRef, Playlist, Thumbnail, Track } from '$lib/core/models';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

function str(v: AnyNode): string | undefined {
  if (typeof v === 'string' && v) return v;
  if (typeof v?.text === 'string' && v.text) return v.text;
  return undefined;
}

function thumbs(node: AnyNode): Thumbnail[] {
  // NOTE: raw shape varies a lot across renderers. `MusicTwoRowItem` exposes
  // `thumbnail` as a plain array, while list items nest it under
  // `thumbnail.contents`. Miss this and playlists/albums lose their art.
  const candidates: AnyNode[] = [
    node?.thumbnail,
    node?.thumbnails,
    node?.thumbnails?.thumbnails,
    node?.thumbnail?.contents,
    node?.thumbnail?.thumbnails,
    node?.thumbnail_contents?.thumbnails,
  ];
  let raw: AnyNode[] = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      raw = candidate;
      break;
    }
    if (Array.isArray(candidate?.contents)) {
      raw = candidate.contents;
      break;
    }
    if (Array.isArray(candidate?.thumbnails)) {
      raw = candidate.thumbnails;
      break;
    }
  }
  return raw
    .map((t) => ({ url: String(t?.url ?? ''), width: t?.width, height: t?.height }))
    .filter((t) => t.url.length > 0);
}

function artistsOf(node: AnyNode): ArtistRef[] {
  const raw: AnyNode[] =
    node?.artists ?? node?.authors ?? node?.subtitle_artists ?? [];
  if (Array.isArray(raw) && raw.length > 0) {
    return raw
      .map((a) => ({
        name: String(a?.name ?? a?.text ?? ''),
        browseId: a?.channel_id ?? a?.browse_id ?? a?.browseId ?? a?.id,
      }))
      .filter((a) => a.name);
  }
  // Fallback: artist names buried in flex-column runs ("Artist • Album • 3:34").
  const cols: AnyNode[] = [...(node?.flex_columns ?? []), ...(node?.fixed_columns ?? [])];
  for (const col of cols.slice(1, 3)) {
    const runs: AnyNode[] = col?.title?.runs ?? [];
    const names = runs
      .filter((r) => r?.endpoint?.name === 'browseEndpoint' && r?.text && !/^\s*•\s*$/.test(r.text))
      .map((r) => String(r.text));
    if (names.length > 0) {
      return names.map((name) => ({ name }));
    }
  }
  const single = node?.artist ?? node?.author;
  if (typeof single === 'string' && single) return [{ name: single }];
  if (single?.name) return [{ name: String(single.name) }];
  return [];
}

function durationToSeconds(v: AnyNode): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  // Parsed `MusicResponsiveListItem.duration` is `{ text, seconds }`; some
  // responses only carry the numeric `seconds`, which the text regex missed —
  // that is what made durations appear for only *some* search rows.
  if (v && typeof v === 'object' && typeof v.seconds === 'number' && Number.isFinite(v.seconds)) {
    return Math.round(v.seconds);
  }
  const text: string | undefined =
    typeof v === 'string' ? v : v?.text ?? v?.label ?? v?.simpleText;
  if (text) {
    const parts = text.split(':').map(Number);
    if (parts.length > 1 && parts.every((n) => Number.isFinite(n))) {
      return parts.reduce((acc, n) => acc * 60 + n, 0);
    }
  }
  return undefined;
}

/** Music search rows often carry duration only as text in flex columns. */
function columnDuration(node: AnyNode): number | undefined {
  const cols: AnyNode[] = [...(node?.flex_columns ?? []), ...(node?.fixed_columns ?? [])];
  for (const col of cols) {
    const texts: string[] = [];
    if (col?.title?.text) texts.push(col.title.text);
    for (const r of col?.title?.runs ?? []) if (r?.text) texts.push(String(r.text));
    for (const t of texts) {
      const m = t.match(/(\d+:)?\d+:\d{2}/);
      if (m) return durationToSeconds(m[0]);
    }
  }
  return undefined;
}

/**
 * Best-effort duration for a song row.
 *
 * Search rows are inconsistent: some carry a parsed `duration.seconds`, some
 * only text in a flex/fixed column, and some hide it in the thumbnail overlay.
 * Check every known spot so a missing value is the exception, not the norm.
 */
function trackDuration(node: AnyNode): number | undefined {
  const direct = durationToSeconds(
    node?.duration ?? node?.length ?? node?.length_text ?? node?.duration_seconds ?? node?.durationSeconds,
  );
  if (direct != null) return direct;

  const fromColumns = columnDuration(node);
  if (fromColumns != null) return fromColumns;

  const overlayBadges: AnyNode[] = [
    ...(node?.thumbnail_overlay_badges ?? []),
    ...(node?.overlay?.content?.badges ?? []),
    ...(node?.overlay?.content?.thumbnail_overlay_badges ?? []),
  ];
  for (const badge of overlayBadges) {
    const d = durationToSeconds(badge?.text ?? badge?.label);
    if (d != null) return d;
  }
  return undefined;
}

function watchVideoId(node: AnyNode): string | undefined {
  const spots = [
    node?.endpoint,
    node?.on_tap,
    node?.overlay?.content?.endpoint,
    node?.flex_columns?.[0]?.title?.endpoint,
  ];
  for (const ep of spots) {
    if (ep?.name === 'watchEndpoint' && ep?.payload?.videoId) {
      return String(ep.payload.videoId);
    }
  }
  return undefined;
}

function isExplicit(node: AnyNode): boolean {
  if (node?.is_explicit) return true;
  const badges: AnyNode[] = node?.badges ?? node?.subtitle_badges ?? [];
  return (
    Array.isArray(badges) &&
    badges.some((b) => /explicit/i.test(b?.label ?? b?.text ?? b?.icon_type ?? ''))
  );
}

export function mapTrack(node: AnyNode): Track | null {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'MusicCardShelf') return mapCardShelf(node);
  // Never coerce library rows into tracks.
  if (['album', 'artist', 'playlist', 'podcast'].includes(node.item_type)) return null;

  const videoId: string | undefined =
    node.video_id ?? (node.item_type == null || ['song', 'video'].includes(node.item_type) ? node.id : undefined) ?? watchVideoId(node);
  const title = str(node.title) ?? str(node.name);
  if (!videoId || !title) return null;

  const albumNode = node.album;
  return {
    videoId: String(videoId),
    title: String(title),
    artists: artistsOf(node),
    album: albumNode && (albumNode.name ?? albumNode.text)
      ? { name: String(albumNode.name ?? albumNode.text), browseId: albumNode.browse_id ?? albumNode.id }
      : undefined,
    durationSeconds: trackDuration(node),
    thumbnails: thumbs(node),
    isExplicit: isExplicit(node),
  };
}

/** Top-result card → playable track. */
export function mapCardShelf(card: AnyNode): Track | null {
  if (!card || card.type !== 'MusicCardShelf') return null;
  const videoId = card.on_tap?.payload?.videoId ?? watchVideoId(card);
  const title = str(card.title);
  if (!videoId || !title) return null;
  // Subtitle looks like "Song • Artist • Album • 3:34" or "Video • Artist • 1.8B views • 3:34".
  const runs: AnyNode[] = card.subtitle?.runs ?? [];
  const parts = runs.map((r) => String(r?.text ?? '')).filter((t) => t && t !== ' • ');
  const artists = parts.length > 1 ? [{ name: parts[1] }] : [];
  let durationSeconds: number | undefined;
  for (let i = parts.length - 1; i >= 0; i--) {
    const d = durationToSeconds(parts[i]);
    if (d != null) {
      durationSeconds = d;
      break;
    }
  }
  return {
    videoId: String(videoId),
    title: String(title),
    artists,
    album: parts.length > 2 && !/views|plays/i.test(parts[2]) ? { name: parts[2] } : undefined,
    durationSeconds,
    thumbnails: thumbs(card),
  };
}

export interface CardShelfResult {
  track?: Track;
  artist?: ArtistRef;
  album?: Album;
  playlist?: Playlist;
}

/**
 * The "Top result" card can be *any* of the four kinds, not only a playable
 * song: searching an artist name returns the **artist** as the top result, and
 * mapping it as a track (which then fails for lack of a video id) silently
 * dropped it — which is why an artist search could list "related" artists but
 * never the one you typed. Detect the page type from the card's browse endpoint.
 */
export function mapCardShelfResult(card: AnyNode): CardShelfResult {
  const track = mapCardShelf(card);
  if (track) return { track };

  const payload = card?.on_tap?.payload ?? {};
  const browseId: unknown = payload.browseId;
  const title = str(card?.title);
  if (typeof browseId !== 'string' || !browseId || !title) return {};

  const pageType: string | undefined =
    payload?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
  const art = thumbs(card);

  if (pageType === 'MUSIC_PAGE_TYPE_ARTIST' || browseId.startsWith('UC')) {
    return { artist: { name: String(title), browseId, thumbnails: art } };
  }
  if (pageType === 'MUSIC_PAGE_TYPE_ALBUM' || browseId.startsWith('MPR')) {
    return { album: { browseId, title: String(title), artists: [], thumbnails: art } };
  }
  if (
    pageType === 'MUSIC_PAGE_TYPE_PLAYLIST' ||
    browseId.startsWith('VL') ||
    browseId.startsWith('PL')
  ) {
    return {
      playlist: {
        browseId: browseId.startsWith('VL') ? browseId : `VL${browseId}`,
        title: String(title),
        thumbnails: art,
      },
    };
  }
  return {};
}

export function mapArtistRef(node: AnyNode): ArtistRef | null {
  if (!node || typeof node !== 'object') return null;
  const name = str(node.name) ?? str(node.title) ?? str(node.header?.title);
  // The browse id is usually `id`/`browse_id`, but some rows only carry it on
  // the navigation endpoint — missing it dropped the artist entirely.
  const browseId =
    node.id ??
    node.browse_id ??
    node.channel_id ??
    node.endpoint?.payload?.browseId ??
    node.on_tap?.payload?.browseId ??
    node.navigation_endpoint?.payload?.browseId;
  if (!name) return null;
  // Search/chip rows carry the artist avatar; keep it so the UI can show a real
  // face instead of a generic placeholder icon.
  return {
    name: String(name),
    browseId: browseId ? String(browseId) : undefined,
    thumbnails: thumbs(node),
  };
}

export function mapAlbum(node: AnyNode): Album | null {
  if (!node || typeof node !== 'object') return null;
  const browseId: string | undefined = node.browse_id ?? node.id;
  const title = str(node.title);
  if (!browseId || !title) return null;
  return {
    browseId: String(browseId),
    title: String(title),
    artists: artistsOf(node),
    year: str(node.year),
    thumbnails: thumbs(node),
  };
}

export function mapPlaylist(node: AnyNode): Playlist | null {
  if (!node || typeof node !== 'object') return null;
  const browseId: string | undefined =
    node.browse_id ??
    node.playlist_id ??
    node.content_id ??
    (node.item_type === 'playlist' ? node.id : undefined);
  const title = str(node.title) ?? str(node.name);
  if (!browseId || !title) return null;
  const subtitleRuns: AnyNode[] = node.subtitle?.runs ?? [];
  const author =
    node.author?.name ??
    subtitleRuns.find((r) => r?.endpoint?.name === 'browseEndpoint')?.text;
  const countText =
    node.count?.text ?? subtitleRuns.map((r) => r?.text ?? '').join(' ');
  const trackCount = Number(String(countText).replace(/[^\d]/g, '')) || undefined;
  return {
    browseId: String(browseId),
    title: String(title),
    author: author ? String(author).split('•')[0].trim() : undefined,
    trackCount,
    thumbnails: thumbs(node),
  };
}
