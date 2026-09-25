// Raw YouTube Music library scanning.
//
// Why this exists: `music.getLibrary()` does
// `sectionList.contents.as(Grid, MusicShelf)`, which **throws** as soon as the
// response contains any other node type — and current YT Music library
// responses include `ItemSection`. That single throw used to abort the whole
// library load (and, via `Promise.all`, the account profile too).
//
// Instead we scan the raw browse JSON ourselves, tolerating whatever node
// types YouTube includes, and extract playlist rows by shape.

import type { Playlist, Thumbnail } from '$lib/core/models';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/** Guard rails so a pathological response can't hang the UI thread. */
const MAX_NODES = 250_000;
const MAX_DEPTH = 24;

export interface LibraryScan {
  playlists: Playlist[];
  /** Renderer type → occurrence count, for diagnosing shape changes. */
  rendererCounts: Record<string, number>;
  continuation?: string;
}

const PLAYLIST_RENDERERS = new Set([
  'musicTwoRowItemRenderer',
  'musicResponsiveListItemRenderer',
]);

/** A playlist browse id: `VL…` (YT Music) or `PL…` (classic). */
function isPlaylistId(id: unknown): id is string {
  return typeof id === 'string' && (id.startsWith('VL') || id.startsWith('PL'));
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

/** Bounded BFS for the first value matching `test`. */
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

/** Extract a playlist row from either row renderer variant. */
function extractPlaylist(renderer: Json): Playlist | null {
  const browse = findFirst(renderer, (value) => isPlaylistId(value?.browseEndpoint?.browseId));
  const browseId: string | undefined = browse?.browseEndpoint?.browseId;
  if (!isPlaylistId(browseId)) return null;

  // Reject albums/artists/podcast shows that reuse the same row renderer.
  const pageType: string | undefined =
    browse?.browseEndpoint?.browseEndpointContextSupportedConfigs
      ?.browseEndpointContextMusicConfig?.pageType;
  if (pageType && pageType !== 'MUSIC_PAGE_TYPE_PLAYLIST') return null;

  // Title: `title` for two-row items, first flex column for responsive rows.
  let title = textOf(renderer.title);
  if (!title && Array.isArray(renderer.flexColumns)) {
    for (const column of renderer.flexColumns) {
      const candidate = textOf(column?.musicResponsiveListItemFlexColumnRenderer?.text);
      if (candidate) {
        title = candidate;
        break;
      }
    }
  }
  if (!title) return null;

  // Author: `subtitle` on two-row items, or the second flex column on
  // responsive rows (the owner line YouTube puts under the title).
  let author = textOf(renderer.subtitle);
  if (!author && Array.isArray(renderer.flexColumns)) {
    const columns = (renderer.flexColumns as Json[])
      .map((column) => textOf(column?.musicResponsiveListItemFlexColumnRenderer?.text))
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    if (columns.length > 1) author = columns[1];
  }

  return {
    browseId,
    title,
    author: author ? author.split('•')[0].trim() : undefined,
    trackCount: undefined,
    thumbnails: thumbnailsOf(renderer),
  };
}

/** Scan one library response page. */
export function scanLibrary(raw: Json): LibraryScan {
  const playlists = new Map<string, Playlist>();
  const rendererCounts: Record<string, number> = {};
  let continuation: string | undefined;

  // Breadth-first with a cursor: preserves document order, so the rail shows
  // playlists in the same order as YouTube Music (a LIFO stack reversed them).
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
      if (key.endsWith('Renderer')) {
        rendererCounts[key] = (rendererCounts[key] ?? 0) + 1;
      }
      if (PLAYLIST_RENDERERS.has(key) && value && typeof value === 'object') {
        const playlist = extractPlaylist(value);
        if (playlist && !playlists.has(playlist.browseId)) {
          playlists.set(playlist.browseId, playlist);
        }
      }
      if (!continuation && key === 'continuationCommand') {
        const token = (value as Json)?.token;
        if (typeof token === 'string' && token) continuation = token;
      }
      if (value && typeof value === 'object') pending.push({ node: value, depth: depth + 1 });
    }
  }

  return { playlists: [...playlists.values()], rendererCounts, continuation };
}
