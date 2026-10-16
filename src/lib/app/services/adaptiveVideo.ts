import { get } from 'svelte/store';
import { settingsStore } from './settings';
import { videoQualities, pickVideoRepresentation, initialVideoBitrate } from './videoQuality';

/** Attach HD video without introducing a second media clock. */
export async function attachAdaptiveVideo(
  media: HTMLMediaElement, manifest: string, fallbackUrl: string,
  stale: () => boolean,
): Promise<{ destroy: () => void; ready: Promise<void> }> {
  const { MediaPlayer } = await import('dashjs');
  if (stale()) throw new DOMException('Playback changed', 'AbortError');
  const player = MediaPlayer().create();
  const url = URL.createObjectURL(new Blob([manifest], { type: 'application/dash+xml' }));
  let disposed = false;
  let fallback = false;
  let restoreFallback: (() => void) | undefined;
  let initialized = false;
  let unsubscribe = () => {};
  let selectedRepresentation: string | undefined;
  function applyQuality(replaceBuffered = false) {
    if (!initialized || disposed || stale()) return;
    const streams = player.getRepresentationsByType('video');
    videoQualities.set([...new Set(streams.map(stream => stream.height).filter(height => height > 0))].sort((a, b) => b - a));
    const stream = pickVideoRepresentation(streams, get(settingsStore).videoQuality);
    player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: !stream } } } });
    // A manual downgrade otherwise waits for the old high-quality buffer to drain.
    // Replace only on a user change; startup and Auto keep normal buffering.
    if (stream && stream.id !== selectedRepresentation) {
      player.setRepresentationForTypeById('video', stream.id, replaceBuffered);
    }
    selectedRepresentation = stream?.id;
  }
  let resolveReady: () => void;
  let rejectReady: (error: Error) => void;
  const metadata = () => resolveReady();
  const readyPromise = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  media.addEventListener('loadedmetadata', metadata, { once: true });
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    videoQualities.set([]);
    clearTimeout(timer);
    media.removeEventListener('loadeddata', ready);
    player.reset();
    URL.revokeObjectURL(url);
  };
  const destroy = () => {
    cleanup();
    media.removeEventListener('loadedmetadata', metadata);
    if (restoreFallback) media.removeEventListener('loadedmetadata', restoreFallback);
    rejectReady(new DOMException('Playback changed', 'AbortError'));
  };
  const useFallback = (reason = 'adaptive stream error') => {
    if (disposed || stale() || fallback) return;
    fallback = true;
    console.warn(`[cherry] HD video fell back to progressive playback (${reason}).`);
    const position = media.currentTime;
    const playing = !media.paused;
    cleanup();
    // Restore a position only after the replacement source has metadata.
    restoreFallback = () => {
      if (stale()) return;
      if (position > 0) media.currentTime = position;
      if (playing) void media.play().catch(() => {});
    };
    media.addEventListener('loadedmetadata', restoreFallback, { once: true });
    media.src = fallbackUrl;
  };
  const ready = () => clearTimeout(timer);
  const timer = setTimeout(() => useFallback('no video frame within 20 seconds'), 20000);
  media.addEventListener('loadeddata', ready, { once: true });
  player.updateSettings({
    debug: { logLevel: 0 },
    streaming: {
      lastBitrateCachingInfo: { enabled: false },
      abr: { initialBitrate: { video: initialVideoBitrate(manifest, get(settingsStore).videoQuality) } },
      buffer: { bufferTimeDefault: 8, bufferTimeAtTopQuality: 15, bufferTimeAtTopQualityLongForm: 15, fastSwitchEnabled: true },
    },
  });
  player.on(MediaPlayer.events.ERROR, () => useFallback());
  player.on(MediaPlayer.events.STREAM_INITIALIZED, () => { initialized = true; applyQuality(); });
  let lastQuality = get(settingsStore).videoQuality;
  unsubscribe = settingsStore.subscribe(settings => {
    if (settings.videoQuality === lastQuality) return;
    lastQuality = settings.videoQuality;
    applyQuality(true);
  });
  try { player.initialize(media, url, false); }
  catch { useFallback('player initialization failed'); }
  return { destroy, ready: readyPromise };
}
