import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { updateMediaSession, clearMediaSession } from './mediaSession';
const info = { title: 'Song', artist: 'Artist', album: 'Album', artwork: '', isPlaying: true, durationSecs: 100, positionSecs: 10 };
beforeEach(() => {
  vi.stubGlobal('MediaMetadata', class { constructor(data: object) { Object.assign(this, data); } });
  Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: { metadata: null, playbackState: 'none', setPositionState: vi.fn() } });
  clearMediaSession();
});
afterEach(() => { vi.unstubAllGlobals(); });
it('keeps the same metadata object on timeline ticks and stays active through track loading', () => {
  updateMediaSession(info); const metadata = navigator.mediaSession.metadata;
  updateMediaSession({ ...info, positionSecs: 11 }); expect(navigator.mediaSession.metadata).toBe(metadata);
  updateMediaSession({ ...info, title: 'Next', isPlaying: false, isLoading: true, positionSecs: 0 });
  expect(navigator.mediaSession.playbackState).toBe('playing'); expect(navigator.mediaSession.metadata?.title).toBe('Next');
  updateMediaSession({ ...info, title: 'Next', isPlaying: false }); expect(navigator.mediaSession.playbackState).toBe('paused');
  clearMediaSession(); expect(navigator.mediaSession.metadata).toBeNull(); expect(navigator.mediaSession.playbackState).toBe('none');
});
