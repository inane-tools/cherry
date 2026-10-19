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
  playback?: HomePlayback;
  params?: string;
  navigation?: boolean;
}

export interface HomePlayback { videoId?: string; playlistId?: string; params?: string }

export interface HomeSong {
  videoId: string;
  title: string;
  subtitle?: string;
  thumbnails: Thumbnail[];
  isMusicVideo?: boolean;
}

export interface HomeSection {
  title: string;
  cards: HomeCard[];
  songs: HomeSong[];
  order?: string[];
  layout?: 'cards' | 'songs' | 'buttons';
  /** Keep collection pages' grid/list structure distinct from Home carousels. */
  presentation?: 'carousel' | 'grid' | 'list';
  rows?: number;
  /** Pagination for this shelf, separate from the surrounding page. */
  continuation?: string;
  header?: { subtitle?: string; thumbnails: Thumbnail[]; profile?: BrowseTarget; more?: BrowseTarget };
}

export interface BrowseTarget { browseId: string; params?: string; pageType?: string }
export interface PageAction { label: string; playback?: HomePlayback; browse?: BrowseTarget; share?: boolean }

export interface HomeFilter { label: string; browseId: string; params?: string }

/** Header shared by artist / album / (playlist) browse pages. */
export interface PageHeader {
  /** Positive proof from YouTube's editable playlist header. */
  canEdit?: boolean;
  title: string;
  subtitle?: string;
  /** Best-effort artist line (album/artist pages). */
  artist?: string;
  /** Playlist creator, separate from media type/year/count metadata. */
  author?: string;
  description?: string;
  thumbnails: Thumbnail[];
  banner?: Thumbnail[];
  actions?: PageAction[];
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
    ...(node.musicEditablePlaylistDetailHeaderRenderer ? { canEdit: true } : {}),
    title: textOf(header.title) ?? textOf(node.title) ?? '',
    subtitle: textOf(header.subtitle) ?? textOf(node.subtitle) ?? textOf(header.subscriptionButton?.subscribeButtonRenderer?.longSubscriberCountText),
    artist: artistHintOf(header),
    author: creatorOf(header),
    description: descriptionOf(header) ?? descriptionFromPage(raw),
    thumbnails: thumbnailsOf(header.foregroundThumbnail ?? header.thumbnail ?? header),
    ...(header.foregroundThumbnail || node.musicImmersiveHeaderRenderer ? { banner: thumbnailsOf(header.thumbnail) } : {}),
    actions: pageActions(header),
  };
}

function pageActions(header: Json): PageAction[] {
  const roots = [header.buttons, header.playButton, header.menu?.menuRenderer?.topLevelButtons, header.menu?.menuRenderer?.items];
  const actions: PageAction[] = [];
  const seen = new Set<string>();
  const pending = [...roots].reverse();
  let visited = 0;
  while (pending.length && visited++ < 1000) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    const button = node.buttonRenderer ?? node.musicPlayButtonRenderer ?? node.menuNavigationItemRenderer;
    if (button) {
      if (button.isDisabled) continue;
      const command = button.navigationEndpoint ?? button.playNavigationEndpoint ?? button.command ?? button.serviceEndpoint;
      const watch = command?.watchPlaylistEndpoint ?? command?.watchEndpoint;
      const playback = watch && (watch.videoId || watch.playlistId)
        ? { videoId: watch.videoId, playlistId: watch.playlistId, params: watch.params } : undefined;
      const browse = browseTarget(command);
      const share = !!command?.shareEntityEndpoint;
      const label = textOf(button.text) ?? button.accessibilityPlayData?.accessibilityData?.label ?? button.tooltip ?? (playback ? 'Play mix' : share ? 'Share' : '');
      if (label && (playback || browse || share)) {
        const key = JSON.stringify([label, playback, browse, share]);
        if (!seen.has(key)) { seen.add(key); actions.push({ label, ...(playback ? { playback } : {}), ...(browse ? { browse } : {}), ...(share ? { share: true } : {}) }); }
      }
      continue;
    }
    pending.push(...(Array.isArray(node) ? [...node].reverse() : Object.values(node).reverse()));
  }
  return actions;
}

function creatorOf(header: Json): string | undefined {
  // Current playlist headers put the owner beside the avatar stack rather
  // than in straplineTextOne. Its label is attributed text, not a runs array.
  const facepileText = header?.facepile?.avatarStackViewModel?.text;
  const facepileName = typeof facepileText?.content === 'string'
    ? facepileText.content.trim() : textOf(facepileText);
  if (facepileName) return facepileName;
  const sources = [header?.straplineTextOne, header?.straplineTextTwo, header?.subtitle, header?.author];
  for (const source of sources) {
    const linked = source?.runs?.find((run: Json) => /^UC/.test(run?.navigationEndpoint?.browseEndpoint?.browseId ?? '') && run?.text?.trim());
    if (linked) return linked.text.trim();
  }
  for (const source of [header?.author, header?.straplineTextOne]) {
    const name = textOf(source);
    if (name && !isNoiseSegment(name)) return name;
  }
  return undefined;
}

/**
 * Best-effort artist line for a page header. YouTube stores it inconsistently:
 * usually `subtitle`, sometimes `straplineTextOne`, while `secondSubtitle`
 * holds the media type / year. Return the first segment that isn't noise.
 */
function artistHintOf(header: Json): string | undefined {
  const sources = [
    textOf(header?.subtitle),
    textOf(header?.straplineTextOne),
    textOf(header?.straplineTextTwo),
    textOf(header?.secondSubtitle),
    textOf(header?.author),
  ].filter((t): t is string => Boolean(t));
  for (const source of sources) {
    const segment = source
      .split('•')
      .map((s) => s.trim())
      .find((s) => s && !isNoiseSegment(s));
    if (segment) return segment;
  }
  return undefined;
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

export function isNoiseSegment(segment: string): boolean {
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
  const endpoint = renderer?.navigationEndpoint ?? renderer?.onTap;
  const title = textOf(renderer?.title);
  if (!title) return {};

  const videoId: string | undefined = endpoint?.watchEndpoint?.videoId;
  if (videoId && !endpoint?.watchEndpoint?.playlistId?.startsWith('RD')) {
    return {
      song: { videoId, title, subtitle: artistLine(renderer), thumbnails: thumbnailsOf(renderer), isMusicVideo: (endpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ?? '').match(/OMV|UGC/) !== null },
    };
  }

  const overlayWatch = findFirst(renderer?.overlay ?? renderer?.thumbnailOverlay, (value) => value?.watchEndpoint || value?.watchPlaylistEndpoint);
  const watch = endpoint?.watchPlaylistEndpoint ?? endpoint?.watchEndpoint ?? overlayWatch?.watchEndpoint ?? overlayWatch?.watchPlaylistEndpoint;
  const playback = watch && (watch.playlistId || watch.videoId) ? { videoId: watch.videoId, playlistId: watch.playlistId, params: watch.params } : undefined;
  const browseId: string | undefined = endpoint?.browseEndpoint?.browseId ?? (playback?.playlistId ? playback.playlistId.startsWith('VL') ? playback.playlistId : `VL${playback.playlistId}` : undefined);
  if (browseId) {
    return {
      card: {
        browseId,
        title,
        subtitle: subtitleOf(renderer),
        pageType: endpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
          ?.browseEndpointContextMusicConfig?.pageType,
        thumbnails: thumbnailsOf(renderer),
        playback,
        params: endpoint?.browseEndpoint?.params,
        navigation: renderer.navigation === true,
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

  const station = findFirst(renderer, value => value?.watchPlaylistEndpoint?.playlistId || value?.watchEndpoint?.playlistId?.startsWith('RD'));
  const radio = station?.watchPlaylistEndpoint ?? station?.watchEndpoint;
  if (radio?.playlistId) {
    return { card: { browseId: radio.playlistId.startsWith('VL') ? radio.playlistId : `VL${radio.playlistId}`,
      title, subtitle: subtitleOf(renderer), thumbnails: thumbnailsOf(renderer),
      playback: { videoId: radio.videoId, playlistId: radio.playlistId, params: radio.params } } };
  }

  // Songs carry a watch endpoint in the first column runs, or on the overlay
  // play button.
  const watch = findFirst(
    [firstColumn, renderer?.navigationEndpoint, renderer?.overlay, renderer?.playlistItemData?.videoId ? { watchEndpoint: { videoId: renderer.playlistItemData.videoId } } : null],
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
    textOf(shelf?.header?.musicCardShelfHeaderBasicRenderer?.title) ??
    textOf(shelf?.header?.musicShelfRenderer?.title) ??
    textOf(shelf?.header?.title) ??
    textOf(shelf?.title) ??
    ''
  );
}

function browseTarget(endpoint: Json): BrowseTarget | undefined {
  const browse = endpoint?.browseEndpoint;
  if (!browse?.browseId) return undefined;
  return { browseId: browse.browseId, ...(browse.params ? { params: browse.params } : {}),
    ...(browse.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType
      ? { pageType: browse.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig.pageType } : {}) };
}

function sectionHeader(shelf: Json): HomeSection['header'] {
  const header = shelf?.header?.musicCarouselShelfBasicHeaderRenderer ?? shelf?.header?.musicCardShelfHeaderBasicRenderer;
  if (!header) return undefined;
  const profileNode = findFirst(header, value => {
    const target = browseTarget(value);
    return target?.pageType === 'MUSIC_PAGE_TYPE_USER_CHANNEL' || !!target?.browseId.startsWith('UC');
  });
  const moreNode = findFirst(header.moreContentButton ?? header.title, value => !!value?.browseEndpoint?.browseId);
  return { subtitle: textOf(header.strapline), thumbnails: thumbnailsOf(header.thumbnail),
    profile: browseTarget(profileNode), more: browseTarget(moreNode) };
}

function ownerContinuation(owner: Json): string | undefined {
  for (const item of owner?.continuations ?? []) {
    const token = item?.nextContinuationData?.continuation ?? item?.reloadContinuationData?.continuation;
    if (typeof token === 'string' && token) return token;
  }
  for (const item of owner?.contents ?? owner?.items ?? []) {
    const token = item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === 'string' && token) return token;
  }
  return undefined;
}

/** Extract the home feed's carousel shelves, in document order. */
export function scanHome(raw: Json): HomeSection[] {
  const sections: HomeSection[] = [];
  const seenTitles = new Set<string>();

  const pending: { node: Json; depth: number }[] = [{ node: raw, depth: 0 }];
  let visited = 0;

  while (pending.length > 0 && visited < MAX_NODES) {
    const { node, depth } = pending.pop()!;
    visited++;
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) continue;

    if (Array.isArray(node)) {
      for (const child of [...node].reverse()) {
        if (child && typeof child === 'object') pending.push({ node: child, depth: depth + 1 });
      }
      continue;
    }

    for (const [key, value] of Object.entries(node).reverse()) {
      if (
        (key === 'musicCarouselShelfRenderer' ||
          key === 'musicShelfRenderer' ||
          key === 'musicPlaylistShelfRenderer' || key === 'musicCardShelfRenderer' || key === 'gridRenderer' || key === 'musicGridRenderer' ||
          key === 'musicShelfContinuation' || key === 'musicCarouselShelfContinuation' || key === 'musicPlaylistShelfContinuation' || key === 'gridContinuation') &&
        value &&
        typeof value === 'object'
      ) {
        const shelf: Json = value;
        const title = sectionTitle(shelf);
        const cards: HomeCard[] = [];
        const songs: HomeSong[] = [];
        const order: string[] = [];
        const contents: Json[] = [...(key === 'musicCardShelfRenderer' ? [{ musicMultiRowListItemRenderer: shelf }] : []), ...(shelf?.contents ?? shelf?.items ?? [])];
        const entries = [...contents].reverse();
        let scanned = 0;
        while (entries.length && scanned++ < 5000) {
          const entry = entries.pop();
          if (!entry || typeof entry !== 'object') continue;
          const responsive = entry.musicResponsiveListItemRenderer;
          const navigation = entry.musicNavigationButtonRenderer;
          const twoRow = entry.musicTwoRowItemRenderer ?? entry.musicMultiRowListItemRenderer ?? entry.gridPlaylistRenderer ?? entry.gridVideoRenderer ?? entry.gridChannelRenderer ?? (navigation ? { title: navigation.buttonText, navigationEndpoint: navigation.clickCommand, navigation: true } : null);
          if (responsive || twoRow) {
            const { card, song } = responsive ? extractResponsive(responsive) : extractTwoRow(twoRow);
            const itemKey = song ? `s:${song.videoId}` : card ? `c:${card.browseId}${card.params ? `:${card.params}` : ''}` : '';
            if (itemKey && !order.includes(itemKey)) {
              order.push(itemKey);
              if (song) songs.push(song);
              if (card) cards.push(card);
            }
            continue;
          }
          // Some shelves group rows under columns or other item containers.
          for (const child of (Array.isArray(entry) ? [...entry] : Object.values(entry)).reverse()) {
            if (child && typeof child === 'object') entries.push(child);
          }
        }
        const dedupeKey = `${title}|${order.join('|')}`;
        if ((cards.length > 0 || songs.length > 0 || ownerContinuation(shelf)) && !seenTitles.has(dedupeKey)) {
          seenTitles.add(dedupeKey);
          const rows = Number.parseInt(shelf.numItemsPerColumn, 10);
          const presentation = /[Gg]rid/.test(key) ? 'grid' : /Carousel|CardShelf/.test(key) ? 'carousel' : songs.length && !cards.length ? 'list' : 'grid';
          sections.push({ title, cards, songs, order, presentation, header: sectionHeader(shelf), ...(ownerContinuation(shelf) ? { continuation: ownerContinuation(shelf) } : {}), ...(Number.isFinite(rows) ? { rows: Math.max(1, Math.min(6, rows)) } : {}), layout: songs.length > 0 && cards.length === 0 ? 'songs' : cards.length > 0 && cards.every((card) => card.navigation) ? 'buttons' : 'cards' });
        }
        continue;
      }
      if (value && typeof value === 'object') pending.push({ node: value, depth: depth + 1 });
    }
  }

  // Some shelf continuations append bare cards/rows rather than a shelf wrapper.
  if (!sections.length) {
    const actions = raw?.onResponseReceivedActions ?? raw?.onResponseReceivedEndpoints ?? [];
    for (const action of actions) {
      const items = action?.appendContinuationItemsAction?.continuationItems;
      if (Array.isArray(items)) sections.push(...scanHome({ musicShelfContinuation: { contents: items } }));
    }
  }
  return sections;
}

/** Only follow the feed's continuation, not a single carousel's own token. */
export function homeContinuation(raw: Json): string | null {
  const section = findFirst(raw, (value) => value?.sectionListRenderer || value?.sectionListContinuation);
  const owner = section?.sectionListRenderer ?? section?.sectionListContinuation;
  for (const item of owner?.continuations ?? []) {
    const token = item?.nextContinuationData?.continuation ?? item?.reloadContinuationData?.continuation;
    if (typeof token === 'string') return token;
  }
  for (const item of owner?.contents ?? []) {
    const token = item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === 'string') return token;
  }
  const actions = raw?.onResponseReceivedActions ?? raw?.onResponseReceivedEndpoints ?? [];
  for (const action of actions) {
    for (const item of action?.appendContinuationItemsAction?.continuationItems ?? []) {
      const token = item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (typeof token === 'string') return token;
    }
  }
  return null;
}

export function scanHomeFilters(raw: Json): HomeFilter[] {
  const cloud = findFirst(raw, (value) => value?.chipCloudRenderer);
  const filters: HomeFilter[] = [];
  for (const item of cloud?.chipCloudRenderer?.chips ?? []) {
    const chip = item.chipCloudChipRenderer;
    const label = textOf(chip?.text);
    const endpoint = chip?.navigationEndpoint?.browseEndpoint;
    if (label && endpoint?.browseId === 'FEmusic_home') filters.push({ label, browseId: endpoint.browseId, params: endpoint.params });
  }
  return filters;
}
