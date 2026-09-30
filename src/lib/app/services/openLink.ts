// Pasting a YouTube / YouTube Music link into the search box opens it, instead
// of searching for the URL text.

import { get } from 'svelte/store';
import { getPlaylistMeta, getTrack } from '$lib/infra/ytmusic/InnertubeClient';
import { authStore } from './auth';
import { playTracks } from './player';
import { openPlaylist } from './playlists';

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
  // Prefer the video if a URL carries both (`watch?v=…&list=…`).
  const videoId = url.searchParams.get('v');
  if (videoId) return { kind: 'track', videoId };
  const list = url.searchParams.get('list');
  if (list) return { kind: 'playlist', playlistId: list };
  return null;
}

/** Play the linked track, or open the linked playlist page. */
export async function openParsedLink(link: ParsedLink): Promise<void> {
  if (!link) return;
  const session = get(authStore);

  if (link.kind === 'track') {
    const track =
      (await getTrack(link.videoId, session)) ?? {
        videoId: link.videoId,
        title: link.videoId,
        artists: [],
        thumbnails: [],
      };
    await playTracks([track], 0);
    return;
  }

  const browseId = link.playlistId.startsWith('VL') ? link.playlistId : `VL${link.playlistId}`;
  const meta = await getPlaylistMeta(browseId, session);
  openPlaylist({ browseId, title: meta?.title ?? 'Playlist', thumbnails: meta?.thumbnails ?? [] });
}
