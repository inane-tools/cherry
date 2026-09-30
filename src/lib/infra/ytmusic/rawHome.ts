// Raw YouTube Music home-feed scanning.
//
// `FEmusic_home` returns carousel shelves mixing album/playlist cards
// (`musicTwoRowItemRenderer`) and song rows (`musicResponsiveListItemRenderer`).
// As with the library, we parse the raw browse JSON rather than relying on
// youtubei.js's typed parsing, which throws on unexpected node types.

import type { Thumbnail } from '$lib/core/models';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const MAX_NODES = 400_000;
const MAX_DEPTH = 26;

export interface HomeCard {
  browseId: string;
  title: string;
  subtitle?: string;
  pageType?: string;
  thumbnails: Thumbnail[];
}

export interface HomeSong {
  videoId: string;
  title: string;
  subtitle?: string;
  thumbnails: Thumbnail[];
}

export interface HomeSection {
  title: string;
  cards: HomeCard[];
  songs: HomeSong[];
}

/** Header shared by artist / album / (playlist) browse pages. */
export interface PageHeader {
  title: string;
  subtitle?: string;
  description?: string;
  thumbnails: Thumbnail[];
}

/** Renderers that carry a page header, in the order we prefer them. */
const HEADER_RENDERERS = [
  'musicImmersiveHeaderRenderer',
  'musicVisualHeaderRenderer',
  'musicDetailHeaderRenderer',
  'musicResponsiveHeaderRenderer',
  'musicEditablePlaylistDetailHeaderRenderer',
];

/** Extract the title/description/artwork block from an artist or album page. */
export function scanPageHeader(raw: Json): PageHeader | null {
  const node = findFirst(raw, (value) => HEADER_RENDERERS.some((key) => value?.[key]));
  if (!node) return null;
  let header = HEADER_RENDERERS.map((key) => node[key]).find(Boolean);
  if (!header) return null;
  // A playlist you own has an *editable* header that wraps the real one
  // (`musicEditablePlaylistDetailHeaderRenderer.header.musicResponsiveHeaderRenderer`).
  // Without unwrapping, every field (including title) read as missing and the
  // whole header was discarded.
  const inner =
    header?.header?.musicResponsiveHeaderRenderer ??
    header?.header?.musicDetailHeaderRenderer ??
    header?.header?.musicVisualHeaderRenderer;
  if (inner) header = inner;
  return {
    title: textOf(header.title) ?? textOf(node.title) ?? '',
    subtitle: textOf(header.subtitle) ?? textOf(node.subtitle),
    description: descriptionOf(header) ?? descriptionFromPage(raw),
    thumbnails: thumbnailsOf(header),
  };
}

/**
 * A playlist/album description is not plain text: it is wrapped in a
 * `musicDescriptionShelfRenderer` (`description.musicDescriptionShelfRenderer
 * .description.runs`), so `textOf(header.description)` alone found nothing.
 */
function descriptionOf(header: Json): string | undefined {
  const direct = textOf(header?.description);
  if (direct) return direct;
  const shelf = header?.description?.musicDescriptionShelfRenderer ?? header?.musicDescriptionShelfRenderer;
  if (!shelf) return undefined;
  return textOf(shelf.description) ?? textOf(shelf);
}

/** Fallback: the description shelf can live outside the header (playlist pages). */
function descriptionFromPage(raw: Json): string | undefined {
  const node = findFirst(raw, (value) => value?.musicDescriptionShelfRenderer);
  if (!node) return undefined;
  const shelf = node.musicDescriptionShelfRenderer;
  return textOf(shelf?.description) ?? textOf(shelf);
}

function textOf(value: Json): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value?.simpleText === 'string' && value.simpleText.trim()) {
    return value.simpleText.trim();
  }
  if (Array.isArray(value?.runs)) {
    const joined = value.runs
      .map((r: Json) => (typeof r?.text === 'string' ? r.text : ''))
      .join('')
      .trim();
    if (joined) return joined;
  }
  return undefined;
}

function thumbnailsOf(root: Json): Thumbnail[] {
  const found = findFirst(root, (value) => {
    if (!Array.isArray(value) || value.length === 0) return false;
    return value.every(
      (t) => t && typeof t === 'object' && typeof t.url === 'string' && t.url.length > 0,
    );
  });
  if (!Array.isArray(found)) return [];
  return found.map((t) => ({ url: String(t.url), width: t.width, height: t.height }));
}

function findFirst(root: Json, test: (value: Json) => boolean): Json | undefined {
  const pending: { node: Json; depth: number }[] = [{ node: root, depth: 0 }];
  let cursor = 0;
  let visited = 0;
  while (cursor < pending.length && visited < MAX_NODES) {
    const { node, depth } = pending[cursor++];
    visited++;
    if (node == null) continue;
    if (test(node)) return node;
    if (typeof node !== 'object' || depth >= MAX_DEPTH) continue;
    const children = Array.isArray(node) ? node : Object.values(node);
    for (const child of children) {
      if (child && typeof child === 'object') pending.push({ node: child, depth: depth + 1 });
    }
  }
  return undefined;
}

/** First subtitle-like text (used for artist/album/year lines). */
function subtitleOf(renderer: Json): string | undefined {
  const subtitle = textOf(renderer?.subtitle);
  if (subtitle) return subtitle;
  // Responsive rows keep their metadata in flex columns after the title.
  const columns: Json[] = renderer?.flexColumns ?? [];
  for (let i = 1; i < columns.length; i++) {
    const value = textOf(columns[i]?.musicResponsiveListItemFlexColumnRenderer?.text);
    if (value && value !== '•') return value.replace(/\s*•\s*/g, ' · ').trim();
  }
  return undefined;
}

/** Metadata segments that are noise for an artist line. */
const MEDIA_TYPE_LABELS = new Set([
  'song',
  'video',
  'single',
  'album',
  'ep',
  'playlist',
  'podcast',
  'artist',
  'movie',
  'show',
  'music video',
]);

function isNoiseSegment(segment: string): boolean {
  const s = segment.trim();
  if (!s) return true;
  if (MEDIA_TYPE_LABELS.has(s.toLowerCase())) return true;
  // "181M views", "4.5M views", "1.2B plays", "3K likes"
  if (/^[\d.,]+[kmb]?\s+(views?|plays?|likes?|subscribers?)$/i.test(s)) return true;
  // "4 songs", "12 tracks"
  if (/^\d+\s+(songs?|tracks?|videos?)$/i.test(s)) return true;
  // A bare year ("2024") is a release date, not an artist.
  if (/^(19|20)\d{2}$/.test(s)) return true;
  return false;
}

/**
 * Artist line for a song row.
 *
 * YouTube packs "Artist • Album • 181M views" into the metadata columns, and
 * whatever we return here ends up in the UI *and* in the Discord presence —
 * which is why view counts used to leak into the rich presence.
 */
function artistLine(renderer: Json): string | undefined {
  const columns: Json[] = renderer?.flexColumns ?? [];
  for (let i = 1; i < columns.length; i++) {
    const runs: Json[] = columns[i]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];
    const segments = runs
      .map((r) => (typeof r?.text === 'string' ? r.text : ''))
      .join('')
      .split('•')
      .map((s) => s.trim())
      .filter((s) => !isNoiseSegment(s));
    if (segments.length > 0) return segments.join(', ');
  }
  // No flex columns: fall back to the subtitle, filtered the same way.
  const raw = textOf(renderer?.subtitle);
  if (!raw) return undefined;
  const segments = raw
    .split('•')
    .map((s) => s.trim())
    .filter((s) => !isNoiseSegment(s));
  return segments.length > 0 ? segments.join(', ') : undefined;
}

/**
 * Extract a card from a two-row item using its **own** `navigationEndpoint`.
 *
 * Using a deep search here was a real bug: song rows carry an artist
 * `browseEndpoint` inside their subtitle, so searching anywhere in the renderer
 * misclassified songs as "artist cards" (with a song title).
 */
function extractTwoRow(renderer: Json): { card?: HomeCard; song?: HomeSong } {
  const endpoint = renderer?.navigationEndpoint;
  const title = textOf(renderer?.title);
  if (!title) return {};

  const videoId: string | undefined = endpoint?.watchEndpoint?.videoId;
  if (videoId) {
    return {
      song: { videoId, title, subtitle: artistLine(renderer), thumbnails: thumbnailsOf(renderer) },
    };
  }

  const browseId: string | undefined = endpoint?.browseEndpoint?.browseId;
  if (browseId) {
    return {
      card: {
        browseId,
        title,
        subtitle: subtitleOf(renderer),
        pageType: endpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
          ?.browseEndpointContextMusicConfig?.pageType,
        thumbnails: thumbnailsOf(renderer),
      },
    };
  }
  return {};
}

/** Extract a card OR song from a responsive list row. */
function extractResponsive(renderer: Json): { card?: HomeCard; song?: HomeSong } {
  const firstColumn = renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text;
  const title = textOf(firstColumn) ?? textOf(renderer?.title);
  if (!title) return {};

  // Songs carry a watch endpoint in the first column runs, or on the overlay
  // play button.
  const watch = findFirst(
    firstColumn ?? renderer?.overlay,
    (value) => typeof value?.watchEndpoint?.videoId === 'string',
  );
  const videoId: string | undefined = watch?.watchEndpoint?.videoId;
  if (videoId) {
    return {
      song: { videoId, title, subtitle: artistLine(renderer), thumbnails: thumbnailsOf(renderer) },
    };
  }

  const browse = findFirst(
    renderer,
    (value) => typeof value?.browseEndpoint?.browseId === 'string',
  );
  const browseId: string | undefined = browse?.browseEndpoint?.browseId;
  if (!browseId) return {};
  return {
    card: {
      browseId,
      title,
      subtitle: subtitleOf(renderer),
      pageType: browse?.browseEndpoint?.browseEndpointContextSupportedConfigs
        ?.browseEndpointContextMusicConfig?.pageType,
      thumbnails: thumbnailsOf(renderer),
    },
  };
}

function sectionTitle(shelf: Json): string {
  return (
    textOf(shelf?.header?.musicCarouselShelfBasicHeaderRenderer?.title) ??
    textOf(shelf?.header?.musicShelfRenderer?.title) ??
    textOf(shelf?.header?.title) ??
    textOf(shelf?.title) ??
    ''
  );
}

/** Extract the home feed's carousel shelves, in document order. */
export function scanHome(raw: Json): HomeSection[] {
  const sections: HomeSection[] = [];
  const seenTitles = new Set<string>();

  const pending: { node: Json; depth: number }[] = [{ node: raw, depth: 0 }];
  let cursor = 0;
  let visited = 0;

  while (cursor < pending.length && visited < MAX_NODES) {
    const { node, depth } = pending[cursor++];
    visited++;
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) continue;

    if (Array.isArray(node)) {
      for (const child of node) {
        if (child && typeof child === 'object') pending.push({ node: child, depth: depth + 1 });
      }
      continue;
    }

    for (const [key, value] of Object.entries(node)) {
      if (
        (key === 'musicCarouselShelfRenderer' ||
          key === 'musicShelfRenderer' ||
          key === 'musicPlaylistShelfRenderer') &&
        value &&
        typeof value === 'object'
      ) {
        const shelf: Json = value;
        const title = sectionTitle(shelf);
        const cards: HomeCard[] = [];
        const songs: HomeSong[] = [];
        const contents: Json[] = shelf?.contents ?? [];
        for (const entry of contents) {
          const twoRow = entry?.musicTwoRowItemRenderer;
          if (twoRow) {
            const { card, song } = extractTwoRow(twoRow);
            if (card) cards.push(card);
            if (song) songs.push(song);
            continue;
          }
          const responsive = entry?.musicResponsiveListItemRenderer;
          if (responsive) {
            const { card, song } = extractResponsive(responsive);
            if (song) songs.push(song);
            else if (card) cards.push(card);
          }
        }
        const dedupeKey = `${title}|${cards.length}|${songs.length}`;
        if ((cards.length > 0 || songs.length > 0) && !seenTitles.has(dedupeKey)) {
          seenTitles.add(dedupeKey);
          sections.push({ title, cards, songs });
        }
        continue;
      }
      if (value && typeof value === 'object') pending.push({ node: value, depth: depth + 1 });
    }
  }

  return sections;
}
