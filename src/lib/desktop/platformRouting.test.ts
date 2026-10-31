import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from './core';
import { listen } from './event';

afterEach(() => { vi.unstubAllGlobals(); });

it.each(['win32', 'darwin'])('keeps Chromium Media Session on %s', async platform => {
  const bridge = { platform, invoke: vi.fn(), subscribe: vi.fn() };
  const session = { metadata: null, playbackState: 'none', setPositionState: vi.fn(), setActionHandler: vi.fn() };
  vi.stubGlobal('window', { cherryDesktop: bridge });
  vi.stubGlobal('navigator', { mediaSession: session });
  vi.stubGlobal('MediaMetadata', class { constructor(data: object) { Object.assign(this, data); } });
  await invoke('media_now_playing', { info: { title: 'Test', artist: '', album: '', artwork: '', isPlaying: true, durationSecs: 30, positionSecs: 5 } });
  expect(session.playbackState).toBe('playing');
  expect(bridge.invoke).not.toHaveBeenCalled();
  const stop = await listen('media-key://play', vi.fn());
  expect(session.setActionHandler).toHaveBeenCalledWith('play', expect.any(Function));
  expect(bridge.subscribe).not.toHaveBeenCalled();
  stop();
  await invoke('media_cleared');
  expect(session.playbackState).toBe('none');
});

it('routes Linux metadata and actions through native MPRIS IPC', async () => {
  const bridge = { platform: 'linux', invoke: vi.fn(), subscribe: vi.fn(() => () => {}) };
  const session = { setActionHandler: vi.fn() };
  vi.stubGlobal('window', { cherryDesktop: bridge });
  vi.stubGlobal('navigator', { mediaSession: session });
  const info = { title: 'Test' };
  await invoke('media_now_playing', { info });
  expect(bridge.invoke).toHaveBeenCalledWith('media_now_playing', { info });
  await listen('media-key://play', vi.fn());
  expect(bridge.subscribe).toHaveBeenCalledWith('media-key://play', expect.any(Function));
  expect(session.setActionHandler).not.toHaveBeenCalled();
  await invoke('media_cleared');
  expect(bridge.invoke).toHaveBeenCalledWith('media_cleared', undefined);
});
