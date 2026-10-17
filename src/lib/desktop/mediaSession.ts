export interface MediaInfo {
  title: string; artist: string; album: string; artwork: string;
  isPlaying: boolean; isLoading?: boolean; durationSecs: number; positionSecs: number;
}
let metadataKey = '';
let playing = false;
export function clearMediaSession(): void {
  if (!('mediaSession' in navigator)) return;
  metadataKey = ''; playing = false;
  navigator.mediaSession.metadata = null;
  navigator.mediaSession.playbackState = 'none';
  navigator.mediaSession.setPositionState();
}
export function updateMediaSession(info: MediaInfo): void {
  if (!('mediaSession' in navigator)) return;
  const session = navigator.mediaSession;
  const key = JSON.stringify([info.title, info.artist, info.album, info.artwork]);
  if (key !== metadataKey || !session.metadata) {
    session.metadata = new MediaMetadata({ title: info.title, artist: info.artist, album: info.album, artwork: info.artwork ? [{ src: info.artwork }] : [] });
    metadataKey = key;
  }
  // Loading is a handoff, not a stop/pause. Keep the OS session active.
  if (!info.isLoading) playing = info.isPlaying;
  session.playbackState = playing ? 'playing' : 'paused';
  if (!info.isLoading) {
    if (info.durationSecs > 0) session.setPositionState({ duration: info.durationSecs, position: Math.max(0, Math.min(info.positionSecs, info.durationSecs)), playbackRate: 1 });
    else session.setPositionState();
  }
}
