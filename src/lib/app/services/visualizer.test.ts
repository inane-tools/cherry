import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const player = vi.hoisted(() => ({ element: null as HTMLMediaElement | null }));
vi.mock('./player', () => ({ currentMediaElement: () => player.element }));

// Minimal Web Audio stand-in: an analyser that reports a fixed spectrum.
class FakeAnalyser {
  fftSize = 0; smoothingTimeConstant = 0; minDecibels = 0; maxDecibels = 0;
  get frequencyBinCount() { return 64; }
  getByteFrequencyData(out: Uint8Array) { out.forEach((_, i) => { out[i] = i < 8 ? 255 : 51; }); }
}
const sources: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
class FakeContext {
  state = 'running';
  createAnalyser() { return new FakeAnalyser(); }
  createMediaStreamSource() { const node = { connect: vi.fn(), disconnect: vi.fn() }; sources.push(node); return node; }
  resume = vi.fn(); close = vi.fn(async () => {});
}

function media(tracks: MediaStreamTrack[] | 'tainted'): HTMLMediaElement {
  const el = document.createElement('audio');
  const captureStream = vi.fn(() => {
    if (tracks === 'tainted') throw new DOMException('Cross-origin media', 'SecurityError');
    return { getAudioTracks: () => tracks } as unknown as MediaStream;
  });
  return Object.assign(el, { captureStream });
}

let visualizer: typeof import('./visualizer');
beforeEach(async () => {
  vi.resetModules();
  sources.length = 0;
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('MediaStream', class { constructor(public tracks: MediaStreamTrack[]) {} });
  visualizer = await import('./visualizer');
});
afterEach(async () => { await visualizer.stopVisualizer(); vi.unstubAllGlobals(); player.element = null; });

it('reads nothing without a playing element or from media it cannot capture', () => {
  const bands = new Float32Array(4).fill(0.5);
  expect(visualizer.readSpectrum(bands)).toBe(false);
  player.element = media('tainted');
  expect(visualizer.readSpectrum(bands)).toBe(false);
  expect([...bands]).toEqual([0.5, 0.5, 0.5, 0.5]);
});

it('waits for the audio track, then maps the spectrum with bass on the left', () => {
  const tracks: MediaStreamTrack[] = [];
  player.element = media(tracks);
  const bands = new Float32Array(6);
  expect(visualizer.readSpectrum(bands)).toBe(false);
  tracks.push({ kind: 'audio' } as MediaStreamTrack);
  expect(visualizer.readSpectrum(bands)).toBe(true);
  expect(bands[0]).toBe(1);
  expect(bands[bands.length - 1]).toBeCloseTo(0.2);
  // captureStream() may only be called once per element.
  expect((player.element as unknown as { captureStream: ReturnType<typeof vi.fn> }).captureStream).toHaveBeenCalledOnce();
});

it('moves its tap to the next element and releases the previous one', () => {
  const first = media([{ kind: 'audio' } as MediaStreamTrack]);
  player.element = first;
  visualizer.readSpectrum(new Float32Array(4));
  player.element = media([{ kind: 'audio' } as MediaStreamTrack]);
  visualizer.readSpectrum(new Float32Array(4));
  expect(sources).toHaveLength(2);
  expect(sources[0].disconnect).toHaveBeenCalled();
  expect(sources[1].disconnect).not.toHaveBeenCalled();
});
