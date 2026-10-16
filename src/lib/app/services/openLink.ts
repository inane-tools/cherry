// Resolve YouTube links into search previews. Resolution never starts playback
// or navigates; those actions belong to the result the user chooses.

import { get } from 'svelte/store';
import { getPlaylistMeta, getTrack } from '$lib/infra/ytmusic/InnertubeClient';
import { authStore } from './auth';
import type { SearchResults } from '$lib/core/models';

export type ParsedLink =
  | { kind: 'track'; videoId: string }
  | { kind: 'playlist'; playlistId: string }
  | null;

/** Recognise a watch or playlist URL; returns null for ordinary search text. */
export function parseYouTubeLink(text: string): ParsedLink {
  const value = text.trim();
  // A URL has no spaces; this also keeps normal multi-word searches out.
  if (!value || /\s/.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value.includes('://') ? value : `https://${value}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '').replace(/^music\./, '').replace(/^m\./, '');
  if (host !== 'youtube.com' && host !== 'youtu.be') return null;

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return id ? { kind: 'track', videoId: id } : null;
  }
  const pathVideo = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1];
  if (pathVideo) return { kind: 'track', videoId: pathVideo };
  // Prefer the video if a URL carries both (`watch?v=…&list=…`).
  const videoId = url.searchParams.get('v');
  if (videoId) return { kind: 'track', videoId };
  const list = url.searchParams.get('list');
  if (list) return { kind: 'playlist', playlistId: list };
  return null;
}

/** Fetch only the linked item's metadata for the ordinary search result UI. */
export async function resolveParsedLink(link: ParsedLink): Promise<SearchResults> {
  const results: SearchResults = { songs: [], playlists: [], albums: [], artists: [] };
  if (!link) return results;
  const session = get(authStore);

  if (link.kind === 'track') {
    const track =
      (await getTrack(link.videoId, session)) ?? {
        videoId: link.videoId,
        title: 'YouTube song',
        artists: [],
        thumbnails: [{ url: `https://i.ytimg.com/vi/${encodeURIComponent(link.videoId)}/hqdefault.jpg` }],
      };
    results.songs.push(track);
    return results;
  }

  const browseId = link.playlistId.startsWith('VL') ? link.playlistId : `VL${link.playlistId}`;
  const meta = await getPlaylistMeta(browseId, session);
  results.playlists.push({ browseId, title: meta?.title ?? 'YouTube playlist', thumbnails: meta?.thumbnails ?? [] });
  return results;
}
