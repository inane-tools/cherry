import './core';
export async function listen<T = unknown>(name: string, callback: (event: { payload: T }) => void): Promise<() => void> {
  const action = ({ 'media-key://play': 'play', 'media-key://pause': 'pause', 'media-key://next': 'nexttrack', 'media-key://prev': 'previoustrack', 'media-key://stop': 'stop', 'media-key://seek': 'seekto', 'media-key://seek-by': 'seekforward' } as Record<string, MediaSessionAction>)[name];
  if (action && 'mediaSession' in navigator) {
    const dispatch = (details: MediaSessionActionDetails) => {
      callback({ payload: (action === 'seekto' ? { positionSecs: details.seekTime ?? 0 } : action === 'seekforward' || action === 'seekbackward' ? { deltaSecs: (details.seekOffset ?? 10) * (action === 'seekbackward' ? -1 : 1) } : undefined) as T });
    };
    try {
      navigator.mediaSession.setActionHandler(action, dispatch);
      if (action === 'seekforward') navigator.mediaSession.setActionHandler('seekbackward', dispatch);
      return () => { navigator.mediaSession.setActionHandler(action, null); if (action === 'seekforward') navigator.mediaSession.setActionHandler('seekbackward', null); };
    } catch { /* Fall back to desktop events where unsupported. */ }
  }
  return window.cherryDesktop?.subscribe(name, payload => callback({ payload: payload as T })) ?? (() => {});
}
