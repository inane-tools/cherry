// Experimental visualizer tap: reads the spectrum of whatever is playing.
//
// It listens through `captureStream()` instead of `createMediaElementSource()`:
// the element keeps playing exactly as before (same output, volume and mute),
// and the analyser only receives a copy. The graph is never connected to the
// speakers. Capturing needs CORS-clean media, which the desktop media proxy
// provides (see `loadCurrent`); anything else simply yields no data.

import { currentMediaElement } from './player';

type CapturableMedia = HTMLMediaElement & { captureStream(): MediaStream };

let context: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let tappedElement: HTMLMediaElement | null = null;
let tappedTrack: MediaStreamTrack | null = null;
let source: MediaStreamAudioSourceNode | null = null;
// captureStream() may only be called once per element; keep its stream.
const streams = new WeakMap<HTMLMediaElement, MediaStream | null>();

function capture(element: HTMLMediaElement): MediaStream | null {
  if (streams.has(element)) return streams.get(element)!;
  let stream: MediaStream | null = null;
  try {
    stream = typeof (element as CapturableMedia).captureStream === 'function'
      ? (element as CapturableMedia).captureStream()
      : null;
  } catch {
    // Cross-origin (not CORS-clean) media cannot be captured.
    stream = null;
  }
  streams.set(element, stream);
  return stream;
}

function detach(): void {
  source?.disconnect();
  source = null;
  tappedElement = null;
  tappedTrack = null;
}

/** Follow the player to its current element. Cheap when nothing changed. */
function sync(): AnalyserNode | null {
  const element = currentMediaElement();
  if (!element) { detach(); return null; }
  const stream = capture(element);
  // The audio track only appears once the element is actually producing sound,
  // and a new source starts a new track.
  const track = stream?.getAudioTracks()[0] ?? null;
  if (element === tappedElement && track === tappedTrack) return source ? analyser : null;
  detach();
  tappedElement = element;
  tappedTrack = track;
  if (!stream || !track) return null;
  context ??= new AudioContext();
  if (!analyser) {
    analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.78;
    analyser.minDecibels = -85;
    analyser.maxDecibels = -20;
  }
  source = context.createMediaStreamSource(new MediaStream([track]));
  source.connect(analyser);
  if (context.state === 'suspended') void context.resume();
  return analyser;
}

/**
 * Fill `bands` with 0–1 levels on a logarithmic frequency scale (bass on the
 * left). Returns false when nothing can be read, leaving `bands` untouched.
 */
let bins: Uint8Array<ArrayBuffer> = new Uint8Array(0);
export function readSpectrum(bands: Float32Array): boolean {
  const node = sync();
  if (!node) return false;
  if (bins.length !== node.frequencyBinCount) bins = new Uint8Array(node.frequencyBinCount);
  node.getByteFrequencyData(bins);
  // Skip the lowest bin (DC/rumble) and the top quarter (little musical energy).
  const first = 1;
  const last = Math.floor(bins.length * 0.75);
  for (let i = 0; i < bands.length; i++) {
    const from = Math.floor(first * Math.pow(last / first, i / bands.length));
    const to = Math.max(from + 1, Math.floor(first * Math.pow(last / first, (i + 1) / bands.length)));
    let peak = 0;
    for (let b = from; b < to && b < bins.length; b++) peak = Math.max(peak, bins[b]);
    bands[i] = peak / 255;
  }
  return true;
}

/** Release the audio graph when the visualizer is turned off. */
export async function stopVisualizer(): Promise<void> {
  detach();
  analyser = null;
  const closing = context;
  context = null;
  await closing?.close().catch(() => {});
}
