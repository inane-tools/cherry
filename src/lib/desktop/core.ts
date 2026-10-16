type DesktopBridge = {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  subscribe(event: string, callback: (payload: unknown) => void): () => void;
};
declare global { interface Window { cherryDesktop?: DesktopBridge } }

export async function invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!window.cherryDesktop) throw new Error('Electron desktop bridge unavailable');
  if (command === 'media_cleared' && 'mediaSession' in navigator) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
    return undefined as T;
  }
  if (command === 'media_now_playing' && 'mediaSession' in navigator) {
    const info = args?.info as { title: string; artist: string; album: string; artwork: string; isPlaying: boolean; durationSecs: number; positionSecs: number };
    navigator.mediaSession.metadata = new MediaMetadata({ title: info.title, artist: info.artist, album: info.album, artwork: info.artwork ? [{ src: info.artwork }] : [] });
    navigator.mediaSession.playbackState = info.isPlaying ? 'playing' : 'paused';
    if (info.durationSecs > 0) navigator.mediaSession.setPositionState({ duration: info.durationSecs, position: Math.max(0, Math.min(info.positionSecs, info.durationSecs)), playbackRate: 1 });
    return undefined as T;
  }
  return window.cherryDesktop.invoke<T>(command, args);
}
export function convertFileSrc(_path: string, protocol: string): string {
  if (protocol !== 'cherry-media') throw new Error('Unsupported resource protocol');
  return 'cherry-media://stream/';
}
