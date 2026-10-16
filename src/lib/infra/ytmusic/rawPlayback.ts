import type { Lyrics, Track } from '$lib/core/models';

type Json = any;
/** Bounded walk: API data must not recurse forever or repeat shared nodes. */
export function findPlaybackNode(root: Json, predicate: (node: Json) => boolean): Json {
  const stack = [root]; const seen = new Set<object>();
  while (stack.length && seen.size < 100_000) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (predicate(node)) return node;
    stack.push(...Object.values(node).filter(v => v && typeof v === 'object').reverse());
  }
  return undefined;
}
function text(value: Json): string {
  if (typeof value === 'string') return value;
  return value?.simpleText ?? value?.runs?.map((r: Json) => r.text ?? '').join('') ?? '';
}
export function parseLyrics(root: Json): Lyrics | null {
  const timed = findPlaybackNode(root, n => Array.isArray(n.timedLyricsData));
  if (timed) {
    const lines = timed.timedLyricsData.map((line: Json) => {
      const start = line.cueRange?.startTimeMilliseconds != null ? Number(line.cueRange.startTimeMilliseconds) : NaN;
      const end = line.cueRange?.endTimeMilliseconds != null ? Number(line.cueRange.endTimeMilliseconds) : NaN;
      return { text: text(line.lyricLine),
        ...(Number.isFinite(start) && start >= 0 ? { startSeconds: start / 1000 } : {}),
        ...(Number.isFinite(end) && end >= start ? { endSeconds: end / 1000 } : {}) };
    }).filter((line: { text: string }) => line.text.trim());
    if (lines.length) return { lines, synced: lines.every((line: { startSeconds?: number }) => line.startSeconds !== undefined), source: text(timed.sourceMessage) || undefined };
  }
  const shelf = findPlaybackNode(root, n => n.musicDescriptionShelfRenderer)?.musicDescriptionShelfRenderer;
  const lyrics = text(shelf?.description);
  return lyrics.trim() ? { lines: lyrics.split('\n').map(text => ({ text })), synced: false, source: text(shelf.footer) || undefined } : null;
}
export function lyricsBrowseId(root: Json): string | undefined {
  const node = findPlaybackNode(root, n => n.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_TRACK_LYRICS'
    || (typeof n.browseEndpoint?.browseId === 'string' && n.browseEndpoint.browseId.startsWith('MPLY')));
  return node?.browseEndpoint?.browseId;
}
export function panelTrack(node: Json): Track | null {
  const videoId = node?.videoId;
  const title = text(node?.title);
  if (!videoId || !title || node.unplayableText) return null;
  const runs = node.longBylineText?.runs ?? node.shortBylineText?.runs ?? [];
  const artists = runs.filter((run: Json) => run.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'))
    .map((run: Json) => ({ name: run.text, browseId: run.navigationEndpoint.browseEndpoint.browseId }));
  const duration = text(node.lengthText).split(':').reduce((total: number, value: string) => total * 60 + Number(value), 0);
  const kind = node.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
  return { videoId, title, artists: artists.length ? artists : text(node.longBylineText) ? [{ name: text(node.longBylineText) }] : [],
    thumbnails: node.thumbnail?.thumbnails ?? [], durationSeconds: duration || undefined,
    isMusicVideo: kind === 'MUSIC_VIDEO_TYPE_OMV' || kind === 'MUSIC_VIDEO_TYPE_UGC' };
}
export function parseRadio(root: Json): { tracks: Track[]; continuation?: string; playlistId?: string } {
  const panel = findPlaybackNode(root, n => n.playlistPanelRenderer || n.playlistPanelContinuation);
  const data = panel?.playlistPanelRenderer ?? panel?.playlistPanelContinuation;
  const tracks: Track[] = []; const seen = new Set<string>(); let selected = 0;
  for (const item of data?.contents ?? []) {
    const node = item.playlistPanelVideoRenderer ?? item.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;
    const track = panelTrack(node);
    if (track && !seen.has(track.videoId)) { if (node.selected) selected = tracks.length; seen.add(track.videoId); tracks.push(track); }
  }
  const continuation = data?.continuations?.[0]?.nextContinuationData?.continuation
    ?? data?.continuations?.[0]?.reloadContinuationData?.continuation;
  return { tracks: tracks.slice(selected), continuation, playlistId: data?.playlistId };
}
export function musicVideoCounterpart(root: Json, currentId: string): Track | null {
  const wrapper = findPlaybackNode(root, n => n.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer?.videoId === currentId)?.playlistPanelVideoWrapperRenderer;
  const candidates = [wrapper?.primaryRenderer?.playlistPanelVideoRenderer,
    ...(wrapper?.counterpart ?? []).map((item: Json) => item.counterpartRenderer?.playlistPanelVideoRenderer)];
  const direct = findPlaybackNode(root, n => n.playlistPanelVideoRenderer?.videoId === currentId)?.playlistPanelVideoRenderer;
  return [...candidates, direct].map(panelTrack).find((track): track is Track => !!track?.isMusicVideo) ?? null;
}
