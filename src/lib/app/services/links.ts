// Canonical YouTube / YouTube Music links and clipboard helpers for the
// right-click menu.
//
// A playlist `browseId` in Innertube is normally prefixed with `VL` (the
// YouTube playlist id is the part after it); video ids are used as-is.

import type { Playlist, Track } from '$lib/core/models';

/** `https://music.youtube.com/watch?v=<id>` */
export function trackMusicUrl(videoId: string): string {
  return `https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/** `https://www.youtube.com/watch?v=<id>` */
export function trackYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/** YouTube playlist id, stripping the Innertube `VL` prefix when present. */
function playlistId(browseId: string): string {
  return browseId.startsWith('VL') ? browseId.slice(2) : browseId;
}

/** `https://music.youtube.com/playlist?list=<id>` */
export function playlistMusicUrl(browseId: string): string {
  return `https://music.youtube.com/playlist?list=${encodeURIComponent(playlistId(browseId))}`;
}

/** `https://www.youtube.com/playlist?list=<id>` */
export function playlistYouTubeUrl(browseId: string): string {
  return `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId(browseId))}`;
}

export function musicUrlForTrack(t: Track): string {
  return trackMusicUrl(t.videoId);
}

export function musicUrlForPlaylist(p: Playlist): string {
  return playlistMusicUrl(p.browseId);
}

/**
 * Copy text to the clipboard, falling back to a hidden textarea when the async
 * Clipboard API is unavailable (it can be in a webview without focus).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
