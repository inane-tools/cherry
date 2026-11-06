import { clearMediaSession, updateMediaSession, type MediaInfo } from './mediaSession';
type DesktopBridge = {
  platform?: string;
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  subscribe(event: string, callback: (payload: unknown) => void): () => void;
};
declare global { interface Window { cherryDesktop?: DesktopBridge } }

export async function invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!window.cherryDesktop) throw new Error('Electron desktop bridge unavailable');
  if (window.cherryDesktop.platform !== 'linux' && command === 'media_cleared') { clearMediaSession(); return undefined as T; }
  if (window.cherryDesktop.platform !== 'linux' && command === 'media_now_playing') { updateMediaSession(args?.info as MediaInfo); return undefined as T; }
  return window.cherryDesktop.invoke<T>(command, args);
}
export function convertFileSrc(_path: string, protocol: string): string {
  if (protocol !== 'cherry-media') throw new Error('Unsupported resource protocol');
  return 'cherry-media://stream/';
}
