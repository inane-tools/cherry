import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { attachAdaptiveVideo } from './adaptiveVideo';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
import { videoQualities } from './videoQuality';

const mocks = vi.hoisted(() => ({
  reset: vi.fn(), initialize: vi.fn(), updateSettings: vi.fn(), on: vi.fn(),
  getRepresentationsByType: vi.fn(() => [
    { id: '360', height: 360, bandwidth: 500000 },
    { id: '720', height: 720, bandwidth: 2000000 },
  ]),
  setRepresentationForTypeById: vi.fn(),
}));
vi.mock('dashjs', () => ({ MediaPlayer: Object.assign(() => ({ create: () => mocks }), { events: { ERROR: 'error', STREAM_INITIALIZED: 'initialized' } }) }));
let media: HTMLVideoElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  settingsStore.update(settings => ({ ...settings, videoQuality: 'auto' }));
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:manifest'), revokeObjectURL: vi.fn() }));
  media = document.createElement('video');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('applies and remembers the preferred quality and changes streams without reloading', async () => {
  settingsStore.update(settings => ({ ...settings, videoQuality: '1080' }));
  const adaptive = await attachAdaptiveVideo(media, '<MPD/>', 'https://fallback.test/video', () => false);
  const initialized = mocks.on.mock.calls.find(call => call[0] === 'initialized')![1];
  initialized();
  expect(get(videoQualities)).toEqual([720, 360]);
  expect(mocks.setRepresentationForTypeById).toHaveBeenLastCalledWith('video', '720', false);
  expect(get(settingsStore).videoQuality).toBe('1080');
  settingsStore.update(settings => ({ ...settings, videoQuality: '360' }));
  expect(mocks.setRepresentationForTypeById).toHaveBeenLastCalledWith('video', '360', true);
  settingsStore.update(settings => ({ ...settings, videoQuality: 'auto' }));
  expect(mocks.updateSettings).toHaveBeenLastCalledWith({ streaming: { abr: { autoSwitchBitrate: { video: true } } } });
  expect(mocks.initialize).toHaveBeenCalledTimes(1);
  media.dispatchEvent(new Event('loadedmetadata')); await adaptive.ready;
  adaptive.destroy();
});

it('waits for metadata and releases the player and manifest on teardown', async () => {
  const adaptive = await attachAdaptiveVideo(media, '<MPD/>', 'https://fallback.test/video', () => false);
  expect(mocks.initialize).toHaveBeenCalledWith(media, 'blob:manifest', false);
  media.dispatchEvent(new Event('loadedmetadata'));
  await adaptive.ready;
  adaptive.destroy();
  adaptive.destroy();
  expect(mocks.reset).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:manifest');
});

it('falls back once after an adaptive error and preserves position', async () => {
  const adaptive = await attachAdaptiveVideo(media, '<MPD/>', 'https://fallback.test/video', () => false);
  media.currentTime = 42;
  const error = mocks.on.mock.calls[0][1];
  error();
  error();
  expect(media.src).toBe('https://fallback.test/video');
  media.dispatchEvent(new Event('loadedmetadata'));
  await adaptive.ready;
  expect(media.currentTime).toBe(42);
  expect(mocks.reset).toHaveBeenCalledTimes(1);
  adaptive.destroy();
});

it('falls back when the adaptive stream never produces a frame', async () => {
  const adaptive = await attachAdaptiveVideo(media, '<MPD/>', 'https://fallback.test/video', () => false);
  await vi.advanceTimersByTimeAsync(20000);
  expect(media.src).toBe('https://fallback.test/video');
  media.dispatchEvent(new Event('loadedmetadata'));
  await adaptive.ready;
  adaptive.destroy();
});

it('cancels an unfinished load without starting its fallback', async () => {
  const adaptive = await attachAdaptiveVideo(media, '<MPD/>', 'https://fallback.test/video', () => false);
  const result = expect(adaptive.ready).rejects.toMatchObject({ name: 'AbortError' });
  adaptive.destroy();
  await result;
  await vi.advanceTimersByTimeAsync(20000);
  expect(media.getAttribute('src')).toBeNull();
});

it('rejects a superseded request before creating a DASH player', async () => {
  await expect(attachAdaptiveVideo(media, '<MPD/>', 'https://fallback.test/video', () => true)).rejects.toMatchObject({ name: 'AbortError' });
  expect(mocks.initialize).not.toHaveBeenCalled();
});


it('does not replace the buffer when two preferences resolve to the same representation', async () => {
  settingsStore.update(settings => ({ ...settings, videoQuality: 'highest' }));
  const adaptive = await attachAdaptiveVideo(media, '<MPD/>', 'https://fallback.test/video', () => false);
  mocks.on.mock.calls.find(call => call[0] === 'initialized')![1]();
  settingsStore.update(settings => ({ ...settings, videoQuality: '1080' }));
  expect(mocks.setRepresentationForTypeById).toHaveBeenCalledTimes(1);
  settingsStore.update(settings => ({ ...settings, videoQuality: '360' }));
  settingsStore.update(settings => ({ ...settings, videoQuality: '720' }));
  expect(mocks.setRepresentationForTypeById).toHaveBeenLastCalledWith('video', '720', true);
  media.dispatchEvent(new Event('loadedmetadata')); await adaptive.ready;
  adaptive.destroy();
});
