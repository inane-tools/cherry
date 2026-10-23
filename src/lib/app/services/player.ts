// Player service: owns the single <audio> element, stream resolution,
// OS integration (media keys metadata via Electron IPC, Discord presence).
//
// Flow: playTrack(s) → queue.setQueue → loadCurrent() → Innertube stream URL
// → audio.src → play. Autoplay advances via queue.step().

import { get, writable } from 'svelte/store';
import { getCurrentWindow } from '$lib/desktop/window';
import type { PlaybackState, Track } from '$lib/core/models';
import { bestThumbnail, trackDisplayArtists } from '$lib/core/models';
import { isRegionRestricted, toCherryError } from '$lib/core/errors';
import { getAudioStream, getInnertube, prefetchAudioStream, getMusicVideo } from '$lib/infra/ytmusic/InnertubeClient';
import { authStore } from './auth';
import { currentItem, queueStore, setQueue, step, setRepeat, setShuffle, cutQueueTo, upNext, enqueue } from './queue';
import type { RepeatMode } from '$lib/core/models';
import { invokeSafe, isDesktop } from './platform';
import { announceSignInRequired } from './gate';
import { settingsStore, updateSettings } from './settings';
import { rememberPosition, restoreQueue, watchQueue } from './queuePersistence';
import { applyArtworkTheme, resetArtworkTheme } from './theme';
import { mediaProxyUrl } from '$lib/infra/ytmusic/mediaProxy';
import { attachAdaptiveVideo } from './adaptiveVideo';
import { videoQualities } from './videoQuality';

export const playerStore = writable<PlaybackState>({
  status: 'idle',
  track: null,
  positionSeconds: 0,
  durationSeconds: 0,
  volume: 0.8,
  muted: false,
});

let audio: HTMLMediaElement | null = null;
let cleanupStream = () => {};
function clearHls(): void {
  const cleanup = cleanupStream;
  cleanupStream = () => {};
  cleanup();
}
const startedMedia = new WeakSet<HTMLMediaElement>();
let outgoingMedia: { media: HTMLMediaElement; cleanup: () => void } | null = null;
function disposeMedia(media: HTMLMediaElement, cleanup: () => void): void {
  cleanup();
  media.pause();
  media.removeAttribute('src');
  media.load();
  media.remove();
}
function releaseOutgoingMedia(): void {
  const outgoing = outgoingMedia;
  outgoingMedia = null;
  if (outgoing) disposeMedia(outgoing.media, outgoing.cleanup);
}
export const videoMode = writable(false);
/** User preference survives tracks that temporarily have no music video. */
export const videoPreferred = writable(false);
export const videoReady = writable(false);
/** Waiting for media bytes, independently of whether playback was requested. */
export const playbackBuffering = writable(false);
let bufferingTimer: ReturnType<typeof setTimeout> | undefined;
function clearBuffering() {
  clearTimeout(bufferingTimer);
  bufferingTimer = undefined;
  playbackBuffering.set(false);
}
async function playbackDeadline<T>(request: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
export const videoResolution = writable<number | null>(null);
let videoHost: HTMLElement | null = null;
/** Reparent the same media element; expanding/collapsing never creates a second clock. */
export function videoSurface(node: HTMLElement) {
  videoHost = node;
  if (audio instanceof HTMLVideoElement) node.appendChild(audio);
  return { destroy() { if (videoHost === node) videoHost = null; } };
}
export async function setVideoMode(enabled: boolean, autoplay?: boolean): Promise<void> {
  if (get(videoPreferred) === enabled) return;
  videoPreferred.set(enabled);
  void updateSettings({ videoPreferred: enabled });
  const state = get(playerStore);
  if (!state.track) return;
  pendingResume = { queueId: get(currentItem)?.queueId ?? '', videoId: get(currentItem)?.track.videoId ?? state.track.videoId, seconds: state.positionSeconds };
  await loadCurrent(autoplay ?? (state.status === 'playing' || state.status === 'loading'));
}

function replaceMedia(video: boolean, fresh = false): HTMLMediaElement {
  if (!fresh && get(videoMode) === video && audio) {
    clearHls();
    return audio;
  }
  clearBuffering();
  const cleanup = cleanupStream;
  cleanupStream = () => {};
  const previous = audio;
  audio = null;
  if (previous) {
    previous.pause();
    previous.remove();
    // Chromium drops audio focus when its last registered media player is
    // destroyed. Keep one paused source until the replacement is playing,
    // including its DASH/HLS attachment. Rapid skips discard unstarted sources
    // instead of accumulating buffers or replacing the last active session.
    if (startedMedia.has(previous)) {
      releaseOutgoingMedia();
      outgoingMedia = { media: previous, cleanup };
    } else disposeMedia(previous, cleanup);
  } else cleanup();
  videoReady.set(false);
  videoResolution.set(null);
  videoMode.set(video);
  return ensureAudio();
}
let sessionUnsub: (() => void) | null = null;
let queueUnsub: (() => void) | null = null;
/**
 * Position to seek to once the restored track's stream loads. Scoped to the
 * track it belongs to (and cleared on any load) so it can never be applied to a
 * different song the user starts first.
 */
let mediaQueueId: string | null = null;
let pendingResume: { queueId: string; videoId: string; seconds: number } | null = null;
// Discord presence is coalesced (see queueDiscord): Discord drops SET_ACTIVITY
// updates beyond 5 per 20 s, which used to leave presence stuck on a stale
// track when skipping/scrubbing quickly.
const DISCORD_MIN_GAP_MS = 4100;
let discordLastPush = 0;
let discordTimer: ReturnType<typeof setTimeout> | null = null;
let discordDirty = false;
let discordWork: Promise<void> = Promise.resolve();
let seekPushTimer: ReturnType<typeof setTimeout> | null = null;

/** How long a paused track may linger before the OS/Discord status is cleared. */
const PAUSE_CLEAR_MS = 60_000;
let pauseClearTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Set once a long pause has cleared the status. Without it the 15 s Discord
 * keep-alive (and any other push) would immediately re-advertise the track that
 * is only paused. Cleared as soon as playback resumes or a new track loads.
 */
let statusSuppressed = false;
/** Restoring metadata alone must never advertise listening on Discord. */
let discordAwaitingPlayback = false;

/**
 * Drop the OS media session and Discord presence once a track has been paused
 * for a minute, so a forgotten pause doesn't keep advertising as "listening".
 *
 * The same rule governs Discord Rich Presence: while paused the presence is
 * updated with a "· Paused" marker, and after `PAUSE_CLEAR_MS` the presence is
 * cleared outright (see `discord_clear_presence`). `statusSuppressed` then stops
 * the 15 s keep-alive and any queued update from re-advertising the track, so a
 * long pause really does end on Discord's side rather than showing "Paused"
 * forever. Resuming (or loading/stopping) lifts the suppression immediately.
 */
function schedulePauseClear(): void {
  cancelPauseClear();
  pauseClearTimer = setTimeout(() => {
    pauseClearTimer = null;
    if (get(playerStore).status !== 'paused') return;
    statusSuppressed = true;
    releaseOutgoingMedia();
    void invokeSafe('media_cleared');
    void refreshDiscord();
  }, PAUSE_CLEAR_MS);
}

function cancelPauseClear(): void {
  if (pauseClearTimer) {
    clearTimeout(pauseClearTimer);
    pauseClearTimer = null;
  }
  // Resuming (or loading/stopping) lifts the suppression.
  statusSuppressed = false;
}

function ensureAudio(): HTMLMediaElement {
  if (!audio) {
    audio = get(videoMode) ? document.createElement('video') : new Audio();
    if (audio instanceof HTMLVideoElement) {
      audio.playsInline = true;
      audio.controls = false;
      audio.className = 'h-full w-full object-cover';
      videoHost?.appendChild(audio);
    }
    const media = audio;
    const listen = (name: string, handler: () => void) => media.addEventListener(name, () => { if (audio === media && mediaQueueId === get(currentItem)?.queueId) handler(); });
    audio.preload = 'auto';
    const s = get(playerStore);
    audio.volume = s.volume;
    audio.muted = s.muted;
    listen('timeupdate', () => {
      if (get(playerStore).status === 'loading') return;
      playerStore.update((p) => ({ ...p, positionSeconds: audio?.currentTime ?? 0 }));
      // Remember the position so a restart resumes where the user left off.
      rememberPosition(audio?.currentTime ?? 0);
    });
    listen('loadedmetadata', () => {
      playerStore.update((p) => ({
        ...p,
        durationSeconds: Number.isFinite(audio?.duration ?? NaN) ? (audio?.duration ?? 0) : p.durationSeconds,
      }));
    });
    listen('loadeddata', () => videoReady.set(media instanceof HTMLVideoElement));
    listen('resize', () => {
      if (media instanceof HTMLVideoElement) {
        videoResolution.set(media.videoHeight || null);
        if (media.videoHeight && !get(videoQualities).length) videoQualities.set([media.videoHeight]);
      }
    });
    listen('emptied', () => videoReady.set(false));
    listen('playing', () => {
      startedMedia.add(media);
      clearBuffering();
      releaseOutgoingMedia();
    });
    const waiting = () => {
      if (get(playerStore).status !== 'playing' || bufferingTimer) return;
      playbackBuffering.set(true);
      bufferingTimer = setTimeout(() => {
        bufferingTimer = undefined;
        if (audio === media && mediaQueueId === get(currentItem)?.queueId && get(playerStore).status === 'playing') {
          recoverMedia(media, 'Playback stalled while buffering.');
        }
      }, 20000);
    };
    listen('waiting', waiting);
    listen('stalled', () => { if (media.readyState < 3) waiting(); });
    listen('play', () => {
      discordAwaitingPlayback = false;
      playerStore.update((p) => ({ ...p, status: 'playing', error: undefined }));
      cancelPauseClear();
      // Force: resume must reach Discord immediately, including fresh timers.
      void pushOsState();
    });
    listen('pause', () => {
      clearBuffering();
      if (media.error || ['loading', 'error'].includes(get(playerStore).status)) return; // Ignore pauses caused by a source handoff.
      // Any pause counts, not just one that interrupted "playing" — otherwise a
      // pause during buffering left the presence looking like it was still on.
      playerStore.update((p) => (p.track ? { ...p, status: 'paused' } : p));
      schedulePauseClear();
      void pushOsState();
    });
    listen('ended', () => { clearBuffering(); if (get(playerStore).status !== 'loading') void onEnded(); });
    listen('error', () => {
      if (!media.getAttribute('src') || recoveryGeneration === loadGeneration) return;
      const state = get(playerStore);
      if (state.status === 'loading' || media.error?.code === 1) return;
      const reason = ({ 2: 'Network stream failed.', 3: 'The media could not be decoded.', 4: 'The stream format is unavailable.' } as Record<number, string>)[media.error?.code ?? 0] ?? 'Playback failed for this track.';
      recoverMedia(media, reason);
    });
  }
  return audio;
}

/** One fresh URL per queue entry, preserving position instead of skipping songs. */
function recoverMedia(media: HTMLMediaElement, reason: string) {
  clearBuffering();
  if (recoveryGeneration === loadGeneration) return;
  const state = get(playerStore);
  const current = get(currentItem);
  const key = current ? current.queueId + ':' + get(videoPreferred) : '';
  if (current && key && key !== recoveredMediaKey && get(authStore)) {
    recoveredMediaKey = key;
    pendingResume = { queueId: current.queueId, videoId: current.track.videoId, seconds: media.currentTime || state.positionSeconds };
    const recovery = loadCurrent(state.status === 'playing', true);
    const generation = loadGeneration;
    recoveryGeneration = generation;
    void recovery.finally(() => { if (recoveryGeneration === generation) recoveryGeneration = null; });
    return;
  }
  media.pause();
  playerStore.update(p => ({ ...p, status: 'error', error: reason }));
  void pushOsState();
}

/**
 * Seek to the remembered position once the media is seekable.
 *
 * A restored queue shows the previous track paused at its last position; the
 * seek can only be applied after metadata loads, and must be applied exactly
 * once, only to the track it was saved for.
 */
function applyPendingResume(el: HTMLMediaElement, videoId: string): void {
  const resume = pendingResume;
  pendingResume = null;
  if (!resume || resume.videoId !== videoId || resume.queueId !== get(currentItem)?.queueId) return;
  const target = resume.seconds;
  const generation = loadGeneration;
  const seek = () => {
    if (generation !== loadGeneration || audio !== el || resume.queueId !== get(currentItem)?.queueId) return;
    // Guard against a bogus remembered position (e.g. longer than the track).
    const max = Number.isFinite(el.duration) && el.duration > 0 ? Math.max(0, el.duration - 1) : target;
    el.currentTime = Math.min(target, max);
    playerStore.update((p) => ({ ...p, positionSeconds: el.currentTime }));
  };
  if (el.readyState >= 1) seek();
  else el.addEventListener('loadedmetadata', seek, { once: true });
}

/**
 * "Stop after this track" (the sleep timer's end-of-track mode). Checked when a
 * track ends: the queue still advances, but the next track is only cued, not
 * played.
 */
export const stopAfterTrack = writable(false);

/**
 * Show the current queue item as paused at 0:00 without resolving its stream
 * (the same state as a restored queue: pressing play loads it).
 */
function cueCurrent(): void {
  const item = get(currentItem);
  const el = ensureAudio();
  loadGeneration++;
  el.removeAttribute('src');
  el.load();
  pendingResume = null;
  playerStore.update((p) => ({
    ...p,
    status: item ? 'paused' : 'idle',
    track: item?.track ?? null,
    positionSeconds: 0,
    durationSeconds: item?.track.durationSeconds ?? 0,
  }));
  if (!item) resetArtworkTheme();
  if (item) schedulePauseClear();
  void pushOsState();
}

async function onEnded(): Promise<void> {
  if (get(stopAfterTrack)) {
    stopAfterTrack.set(false);
    if (step(1, true)) cueCurrent();
    else await stopPlayback();
    return;
  }
  const repeat = get(queueStore.repeat);
  if (repeat === 'one') {
    const el = ensureAudio();
    el.currentTime = 0;
    await el.play().catch(() => undefined);
    return;
  }
  const advanced = step(1);
  if (advanced) await loadCurrent(true);
  // Queue finished: clear everything (including Discord) instead of leaving a
  // paused entry for a song that is no longer loaded.
  else await stopPlayback();
}

/**
 * Keep the OS window title in step with what is playing:
 * `Song - Artist [ Cherry ]`, falling back to just `Cherry` when idle.
 *
 * Only fires `setTitle` when the composed title actually changes, so the
 * ~4-per-second position updates never reach the window manager.
 */
let titleUnsub: (() => void) | null = null;
let lastWindowTitle = '';
function initWindowTitle(): void {
  if (titleUnsub) return;
  titleUnsub = playerStore.subscribe((state) => {
    const title = state.track
      ? `${state.track.title} - ${trackDisplayArtists(state.track)} [ Cherry ]`
      : 'Cherry';
    if (title === lastWindowTitle) return;
    lastWindowTitle = title;
    if (!isDesktop()) return;
    void getCurrentWindow().setTitle(title).catch(() => undefined);
  });
}

/** Pre-warm Innertube so first search/play feels instant. */
export function warmup(): void {
  ensureAudio();
  // Keep the persisted queue in step with the live one.
  watchQueue();
  initWindowTitle();
  if (!sessionUnsub) {
    sessionUnsub = authStore.subscribe(() => {
      getInnertube(get(authStore)).catch(() => undefined);
    });
  }
  if (!queueUnsub) {
    // Emptying the queue (clear, or removing the last track) must tear down the
    // player too, otherwise Discord keeps advertising a track nobody is on.
    queueUnsub = queueStore.items.subscribe((items) => {
      if (items.length === 0 && get(playerStore).track) void stopPlayback();
    });
  }
  getInnertube(get(authStore)).catch(() => undefined);
}

export async function playTracks(tracks: Track[], startAt = 0): Promise<void> {
  if (tracks.length === 0) return;
  // Auth gate: anonymous streams are PO-token gated and fail to resolve, so
  // playing without a session would only ever surface a stream error. Block it
  // centrally — every play path (search, album, playlist, autoplay) funnels
  // through here or `toggle`.
  if (!get(authStore)) {
    announceSignInRequired();
    return;
  }
  setQueue(tracks, startAt);
  await loadCurrent(true);
}

/** Append without interrupting playback or reshuffling the existing queue. */
export function addToQueue(tracks: Track[]): number {
  if (!get(authStore)) { announceSignInRequired(); return 0; }
  const playable = tracks.filter(track => !!track.videoId);
  const empty = get(queueStore.items).length === 0;
  enqueue(playable, false, { appendInOrder: true });
  if (empty && playable.length) {
    discordAwaitingPlayback = true;
    cueCurrent();
  }
  return playable.length;
}

/**
 * Play a list with shuffle on, starting from a random track.
 *
 * Turning shuffle on *before* `setQueue` makes the queue build its play order
 * shuffled, so the first track is genuinely random rather than always the
 * list's first entry (which is what setting shuffle afterwards would give).
 */
export async function playTracksShuffled(tracks: Track[]): Promise<void> {
  if (tracks.length === 0) return;
  if (!get(authStore)) {
    announceSignInRequired();
    return;
  }
  setShuffle(true);
  await playTracks(tracks, Math.floor(Math.random() * tracks.length));
}

export async function toggle(): Promise<void> {
  const el = ensureAudio();
  const st = get(playerStore);
  if (st.status === 'loading') {
    loadGeneration++; clearHls();
    el.pause(); el.removeAttribute('src'); el.load();
    playerStore.update(p => ({ ...p, status: 'paused' }));
    schedulePauseClear();
    await pushOsState();
  } else if (st.status === 'playing') {
    el.pause();
  } else if (st.track) {
    // A restored track has metadata but **no source yet** — streams are
    // resolved lazily — so `el.play()` would fail silently and the track would
    // refuse to start while the rest of the queue played fine. Load it instead.
    if (!el.getAttribute('src')) await loadCurrent(true);
    else await el.play().catch(() => undefined);
  } else if (!get(authStore)) {
    announceSignInRequired();
  } else {
    await loadCurrent(true);
  }
}

export async function next(): Promise<void> {
  // Manual skip ignores repeat-one, so Next always advances to another track.
  if (step(1, true)) await loadCurrent(true);
}

export async function prev(): Promise<void> {
  const el = ensureAudio();
  if (el.currentTime > 3) {
    el.currentTime = 0;
    return;
  }
  if (step(-1)) await loadCurrent(true);
  else el.currentTime = 0;
}

/**
 * Jump to a specific queue entry (the "Up next" popup).
 *
 * `queue.moveTo` only re-points the queue index — it has no access to the
 * audio element — so the track has to be loaded here. Without this the list
 * updated (the clicked entry left "Next up") while the previous song kept
 * playing.
 */
export async function playQueueItem(queueId: string): Promise<void> {
  const before = get(currentItem);
  // Selecting a track from "Up next" drops everything before it, so the songs
  // you skipped do not linger in the queue.
  if (!cutQueueTo(queueId)) return;
  const after = get(currentItem);
  // Clicking the entry that is already playing should not restart it — but a
  // restored entry has no source yet, so it still needs loading.
  const el = ensureAudio();
  if (before && after && before.queueId === after.queueId && el.getAttribute('src')) return;
  await loadCurrent(true);
}

export function seekTo(seconds: number): void {
  const el = ensureAudio();
  const target = Math.max(0, seconds);
  // A restored track has no source yet: remember the seek so it is applied when
  // the stream loads, instead of being silently dropped.
  if (!el.getAttribute('src') || get(playerStore).status === 'loading' || mediaQueueId !== get(currentItem)?.queueId) {
    const track = get(playerStore).track;
    const item = get(currentItem);
    if (track && item) pendingResume = { queueId: item.queueId, videoId: track.videoId, seconds: target };
    playerStore.update((p) => ({ ...p, positionSeconds: target }));
    rememberPosition(target);
    return;
  }
  el.currentTime = target;
  playerStore.update((p) => ({ ...p, positionSeconds: el.currentTime }));
  rememberPosition(el.currentTime);
  // Discord derives elapsed time from the timestamp we last sent, so a seek
  // must refresh it. Debounced because dragging the scrubber fires rapidly.
  if (seekPushTimer) clearTimeout(seekPushTimer);
  seekPushTimer = setTimeout(() => void pushOsState(), 350);
}

// Stops playback entirely and clears the OS media session and Discord presence.
// Used when the queue is exhausted or emptied so nothing lingers.
export async function stopPlayback(): Promise<void> {
  clearBuffering();
  releaseOutgoingMedia();
  clearHls();
  // A stream resolving after Stop must not reattach its source and autoplay.
  loadGeneration++;
  pendingResume = null;
  cancelPauseClear();
  const el = ensureAudio();
  el.pause();
  el.removeAttribute('src');
  el.load();
  playerStore.update((p) => ({
    ...p,
    status: 'idle',
    track: null,
    positionSeconds: 0,
    durationSeconds: 0,
  }));
  resetArtworkTheme();
  await pushOsState();
}

/**
 * Restore the queue and the current track/position from the last session.
 *
 * Deliberately **does not autoplay**: launching the app should not start music.
 * The track is shown as paused at the remembered position; pressing play
 * streams it from there. Called once at startup, after the session is restored.
 */
export async function restorePlayback(): Promise<void> {
  if (get(playerStore).track) return;
  const position = restoreQueue();
  if (position === null) return;
  const item = get(currentItem);
  if (!item) return;
  // Make sure the audio element exists so `toggle()` can reuse it.
  ensureAudio();
  discordAwaitingPlayback = true;
  playerStore.update((p) => ({
    ...p,
    status: 'paused',
    track: item.track,
    positionSeconds: position,
    durationSeconds: item.track.durationSeconds ?? 0,
  }));
  // A paused UI needs a real source before it can seek; the stream is resolved
  // lazily by `toggle()`, so hold the position and apply it on load instead.
  pendingResume = position > 0 ? { queueId: item.queueId, videoId: item.track.videoId, seconds: position } : null;
  schedulePauseClear();
  // Record it too: otherwise the next queue save would persist position 0 and
  // quitting without pressing play would lose where the user was.
  rememberPosition(position);
  void applyArtworkTheme(bestThumbnail(item.track.thumbnails, 256));
  // Clear any stale OS presence from a previous run; the card is re-pushed when
  // playback actually starts.
  await pushOsState();
  if (get(settingsStore).videoPreferred && get(currentItem) === item) {
    videoPreferred.set(true);
    // Use the real media element so buffered video is reused on expansion.
    // No play() call: startup must stay paused and presence must stay clear.
    void loadCurrent(false);
  }
}

/** Toggle shuffle and remember the choice for the next start. */
export function toggleShuffle(): void {
  const on = !get(queueStore.shuffle);
  setShuffle(on);
  void updateSettings({ shuffle: on });
}

const REPEAT_CYCLE: RepeatMode[] = ['off', 'all', 'one'];

/** Cycle repeat off → all → one → off, and remember it. */
export function cycleRepeat(): RepeatMode {
  const current = get(queueStore.repeat);
  const next = REPEAT_CYCLE[(REPEAT_CYCLE.indexOf(current) + 1) % REPEAT_CYCLE.length];
  setRepeat(next);
  void updateSettings({ repeat: next });
  return next;
}

/** Seek relative to the current position (keyboard shortcuts, media keys). */
export function seekBy(deltaSeconds: number): void {
  const st = get(playerStore);
  const max = st.durationSeconds > 0 ? st.durationSeconds : Infinity;
  seekTo(Math.min(max, Math.max(0, st.positionSeconds + deltaSeconds)));
}

/**
 * Fade the volume to silence over `durationMs`, pause, then put the volume back
 * (so the next play is at the user's level). Used by the sleep timer. An abort
 * restores the volume immediately and keeps playing.
 */
export function fadeOutAndPause(durationMs: number, signal?: AbortSignal): Promise<void> {
  const el = ensureAudio();
  const start = el.volume;
  const steps = Math.max(1, Math.round(durationMs / 100));
  return new Promise((resolve) => {
    let n = 0;
    const timer = setInterval(() => {
      if (signal?.aborted) {
        clearInterval(timer);
        el.volume = start;
        resolve();
        return;
      }
      n++;
      el.volume = start * Math.max(0, 1 - n / steps);
      if (n >= steps) {
        clearInterval(timer);
        el.pause();
        el.volume = start;
        resolve();
      }
    }, durationMs / steps);
  });
}

export function setVolume(v: number): void {
  const el = ensureAudio();
  const volume = Math.min(1, Math.max(0, v));
  el.volume = volume;
  el.muted = volume === 0 ? el.muted : false;
  playerStore.update((p) => ({ ...p, volume, muted: el.muted }));
  // Persist (debounced): dragging the slider fires many events, and this must
  // survive a restart rather than only living in the in-memory store.
  settingsStore.update((s) => ({ ...s, volume, muted: el.muted }));
  void persistVolume(volume, el.muted);
}

export function setMuted(m: boolean): void {
  const el = ensureAudio();
  el.muted = m;
  playerStore.update((p) => ({ ...p, muted: m }));
  settingsStore.update((s) => ({ ...s, muted: m }));
  void persistVolume(el.volume, m);
}

let volumeSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingVolume: { volume: number; muted: boolean } | null = null;

function persistVolume(volume: number, muted: boolean): Promise<void> {
  pendingVolume = { volume, muted };
  if (volumeSaveTimer) clearTimeout(volumeSaveTimer);
  return new Promise((resolve) => {
    volumeSaveTimer = setTimeout(() => {
      volumeSaveTimer = null;
      const next = pendingVolume;
      pendingVolume = null;
      if (next) void updateSettings(next).finally(resolve);
      else resolve();
    }, 400);
  });
}

/**
 * Apply stored playback preferences to the audio element and queue.
 *
 * Called once at startup: previously the player always began at the hardcoded
 * default volume because settings were never read back into it.
 */
export function applyStoredPlaybackSettings(): void {
  const { volume, muted, repeat, shuffle } = get(settingsStore);
  const el = ensureAudio();
  el.volume = Math.min(1, Math.max(0, volume));
  el.muted = muted;
  playerStore.update((p) => ({ ...p, volume: el.volume, muted }));
  setRepeat(repeat);
  setShuffle(shuffle);
}

/**
 * Warm the next track's stream while the current one plays, so a skip is
 * instant. Only the immediately-next item is fetched (never the whole queue) and
 * failures are ignored — it is purely an optimization.
 */
let prefetching = false;
async function prefetchNext(): Promise<void> {
  if (prefetching) return;
  const next = get(upNext)[0];
  const session = get(authStore);
  if (!next || !session) return;
  prefetching = true;
  try {
    if (get(videoPreferred)) {
      const counterpart = next.track.isMusicVideo ? next.track : await getMusicVideo(next.track.videoId, session);
      if (get(authStore)?.cookie !== session.cookie || !get(videoPreferred)) return;
      if (counterpart) await prefetchAudioStream(counterpart.videoId, session, { video: true });
      else await prefetchAudioStream(next.track.videoId, session);
    } else await prefetchAudioStream(next.track.videoId, session);
  } catch {
    /* best-effort */
  } finally {
    prefetching = false;
  }
}

/**
 * Incremented on every `loadCurrent`. Each load captures its own value and
 * checks it after every `await`, so a load that was overtaken (the user skipped
 * while its stream was resolving) can never touch the audio element.
 *
 * Without this, rapid skipping played the wrong song: track A's `el.play()`
 * rejected with an AbortError when track B's load replaced the source, A's
 * catch block treated that as an expired URL, re-resolved A and set it as the
 * source again — so A played while the UI showed B.
 */
let loadGeneration = 0;
let recoveredMediaKey = '';
let recoveryGeneration: number | null = null;

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

async function loadCurrent(autoplay: boolean, refreshStream = false, restricted = new Set<string>()): Promise<void> {
  clearBuffering();
  cancelPauseClear();
  const generation = ++loadGeneration;
  const stale = () => generation !== loadGeneration;
  const item = get(currentItem);
  if (pendingResume?.queueId !== item?.queueId) pendingResume = null;
  let el = ensureAudio();
  if (!item) {
    clearHls();
    el.pause();
    el.removeAttribute('src');
    playerStore.update((p) => ({ ...p, status: 'idle', track: null, positionSeconds: 0, durationSeconds: 0 }));
    resetArtworkTheme();
    await pushOsState();
    return;
  }
  playerStore.update((p) => ({
    ...p,
    status: 'loading',
    isLive: false,
    track: item.track,
    positionSeconds: 0,
    durationSeconds: item.track.durationSeconds ?? 0,
    error: undefined,
  }));
  // Keep the paused outgoing source attached until its replacement is ready.
  // Dropping it here unregisters Chromium's media session between every song.
  el.pause();
  // Theme the app from the new track's artwork (fire and forget).
  void applyArtworkTheme(bestThumbnail(item.track.thumbnails, 256));
  void pushOsState();
  if (stale()) return;

  // Gate again here: autoplay can advance into this after a sign-out.
  const session = get(authStore);
  if (!session) {
    playerStore.update((p) => ({ ...p, status: 'idle', track: null }));
    await pushOsState();
    announceSignInRequired();
    return;
  }

  let videoId = item.track.videoId;
  let playVideo = false;
  if (get(videoPreferred)) {
    // Fetch the player/decipher code and DASH module while locating the video,
    // rather than waiting for the counterpart request to finish first.
    void getInnertube(session, { retrievePlayer: true }).catch(() => {});
    void import('dashjs').catch(() => {});
    try {
      const counterpart = item.track.isMusicVideo ? item.track : await playbackDeadline(getMusicVideo(videoId, session), 10000, 'Music video lookup timed out.');
      if (stale()) return;
      if (counterpart) {
        playVideo = true;
        if (pendingResume?.videoId === videoId) pendingResume.videoId = counterpart.videoId;
        videoId = counterpart.videoId;
        playerStore.update(p => ({ ...p, track: counterpart }));
      }
    } catch (error) {
      if (stale()) return;
      // A failed availability lookup should not interrupt ordinary audio or
      // clear the preference for the following track.
      console.warn('[cherry] Music video lookup failed; continuing with audio.');
    }
  }
  if (stale()) return;
  const start = async (refresh: boolean): Promise<void> => {
    playerStore.update(p => ({ ...p, status: 'loading' }));
    if (refresh) {
      // Cancel an unresolved play() before fetching its replacement. Its late
      // completion must not restart the failed source during the retry.
      clearHls(); el.pause(); el.removeAttribute('src'); el.load();
    }
    videoReady.set(false);
    videoResolution.set(null);
    videoQualities.set([]);
    const { track, stream } = await playbackDeadline(getAudioStream(videoId, session, { refresh, ...(playVideo ? { video: true } : {}) }), 30000, 'The stream request took too long.');
    if (stale()) return;
    playerStore.update(p => ({ ...p, isLive: stream.isLive === true }));
    // Never attach a new queue entry to the old track's media clock. A stale
    // ended/metadata event or DASH fallback must not seek/skip the next song.
    el = replaceMedia(playVideo, refresh || mediaQueueId !== item.queueId);
    mediaQueueId = item.queueId;
    if (stream.dashManifest && get(videoMode)) {
      const adaptive = await attachAdaptiveVideo(el, stream.dashManifest, mediaProxyUrl(new URL(stream.url)).href, stale);
      if (stale()) { adaptive.destroy(); await adaptive.ready; return; }
      cleanupStream = () => adaptive.destroy();
      await playbackDeadline(adaptive.ready, 45000, 'The video stream took too long to load.');
      if (stale()) return;
    } else if (/mpegurl/i.test(stream.mimeType) && !el.canPlayType(stream.mimeType)) {
      const { default: Hls } = await import('hls.js');
      if (stale()) return;
      if (!Hls.isSupported()) throw new Error('Live playback is not supported by this browser engine.');
      const hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60 });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The live station took too long to load.')), 20000);
        cleanupStream = () => { clearTimeout(timer); hls.destroy(); reject(new DOMException('Playback changed', 'AbortError')); };
        hls.on(Hls.Events.MANIFEST_PARSED, () => { clearTimeout(timer); resolve(); });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal || stale()) return;
          clearTimeout(timer);
          const error = new Error('The live station stream could not be loaded.');
          reject(error);
          playerStore.update(p => ({ ...p, status: 'error', error: error.message }));
          void pushOsState();
        });
        hls.attachMedia(el);
        hls.loadSource(stream.url);
      });
      if (stale()) return;
    } else {
      const source = new URL(stream.url);
      el.src = source.hostname === 'googlevideo.com' || source.hostname.endsWith('.googlevideo.com') ? mediaProxyUrl(source).href : source.href;
    }
    applyPendingResume(el, videoId);
    if (track.durationSeconds) {
      playerStore.update((p) => ({ ...p, durationSeconds: track.durationSeconds as number }));
    }
    if (autoplay) {
      try {
        await playbackDeadline(el.play(), 20000, 'Playback took too long to start.');
      } catch (e) {
        // Blocked by an autoplay policy: the source is fine, so leave the track
        // loaded and paused instead of re-resolving it as if the URL had failed.
        if (!(e instanceof DOMException && e.name === 'NotAllowedError')) throw e;
        if (!stale()) playerStore.update((p) => ({ ...p, status: 'paused' }));
      }
    }
    if (stale()) return;
    if (!autoplay) playerStore.update(p => ({ ...p, status: 'paused' }));
    // Warm the next track so skipping is instant.
    void prefetchNext();
  };

  const startWithVideoFallback = async (refresh: boolean) => {
    try { await start(refresh); }
    catch (error) {
      if (stale() || !isRegionRestricted(error) || !playVideo || videoId === item.track.videoId) throw error;
      // A restricted video counterpart does not mean its audio song is blocked.
      playVideo = false; videoId = item.track.videoId;
      if (pendingResume?.queueId === item.queueId) pendingResume.videoId = videoId;
      playerStore.update(state => ({ ...state, track: item.track }));
      await start(false);
    }
  };
  const skipRestricted = async (error: unknown): Promise<boolean> => {
    if (!autoplay || !isRegionRestricted(error)) return false;
    restricted.add(item.track.videoId);
    clearHls(); el.pause(); el.removeAttribute('src'); el.load();
    // Follow the actual shuffle order, ignoring repeat-one. Do not wrap forever
    // when repeat-all encounters a queue made entirely of blocked songs.
    let remaining = get(queueStore.items).length;
    while (remaining-- > 0 && step(1, true)) {
      const candidate = get(currentItem);
      if (candidate && !restricted.has(candidate.track.videoId)) {
        await loadCurrent(true, false, restricted);
        return true;
      }
    }
    await stopPlayback();
    return true;
  };

  try {
    await startWithVideoFallback(refreshStream);
  } catch (e) {
    // An overtaken load, or a play() interrupted by a newer source, is not a
    // failure of this track — there is nothing to retry or report.
    if (stale() || isAbort(e)) return;
    if (await skipRestricted(e)) return;
    if (stale()) return;
    let err = toCherryError(e);
    // The cached stream URL may have expired: retry once per load, bypassing
    // the cache.
    try {
      await startWithVideoFallback(true);
      return;
    } catch (retryError) {
      if (stale() || isAbort(retryError)) return;
      if (await skipRestricted(retryError)) return;
      if (stale()) return;
      err = toCherryError(retryError);
    }
    // A failed replacement must not leave the previous song available to Play.
    clearHls(); el.pause(); el.removeAttribute('src'); el.load();
    playerStore.update((p) => ({ ...p, status: 'error', error: err.message }));
    await pushOsState();
  }
}

// ── OS integration ──────────────────────────────────────────────

async function pushMediaState(): Promise<void> {
  const st = get(playerStore);
  if (!st.track || st.status === 'error') releaseOutgoingMedia();
  // A long pause already cleared the status; don't re-advertise it.
  if (statusSuppressed) return;
  const t = st.track;
  if (!t) {
    await invokeSafe('media_cleared');
    return;
  }
  // NOTE: the command takes an `info` argument, so the payload must be nested.
  // (A flat object silently failed to deserialize, which is why the OS media
  // card never appeared at all.)
  await invokeSafe('media_now_playing', {
    info: {
      title: t.title,
      artist: t.artists.map((a) => a.name).join(', '),
      album: t.album?.name ?? '',
      artwork: bestThumbnail(t.thumbnails, 512),
      durationSecs: Math.round(st.durationSeconds || t.durationSeconds || 0),
      // The SMTC (taskbar preview + Action Center card) renders its scrubber
      // from this, so it must be the live position.
      positionSecs: Math.round(st.positionSeconds),
      isPlaying: st.status === 'playing',
      isLoading: st.status === 'loading',
    },
  });
}

async function pushOsState(): Promise<void> {
  await pushMediaState();
  await queueDiscord();
}

/**
 * Ask for a Discord presence update.
 *
 * Updates are coalesced to one per `DISCORD_MIN_GAP_MS` and always send the
 * *current* player state, so a burst of changes (skipping tracks, scrubbing)
 * converges on the right track instead of being dropped by Discord's
 * SET_ACTIVITY rate limit and leaving the presence stuck.
 */
function queueDiscord(): void | Promise<void> {
  // Clears bypass the playback rate-limit gap and follow any in-flight write.
  const st = get(playerStore);
  if (discordAwaitingPlayback || statusSuppressed || !get(settingsStore).discordEnabled || !st.track || st.status === 'idle' || st.status === 'error') {
    return refreshDiscord();
  }
  discordDirty = true;
  if (discordTimer) return;
  const wait = Math.max(0, DISCORD_MIN_GAP_MS - (Date.now() - discordLastPush));
  discordTimer = setTimeout(() => {
    discordTimer = null;
    if (discordDirty) void flushDiscord();
  }, wait);
}

function flushDiscord(): Promise<void> {
  const task = discordWork.then(sendDiscordState);
  discordWork = task.catch(() => {});
  return task;
}

async function sendDiscordState(): Promise<void> {
  if (!isDesktop()) return;
  // Read state after importing IPC and after prior writes finish, so an old
  // snapshot cannot restore presence after Stop, disable, or a long pause.
  const { invoke } = await import('$lib/desktop/core');
  discordDirty = false;
  discordLastPush = Date.now();
  const st = get(playerStore);
  const settings = get(settingsStore);
  const track = st.track;
  try {
    if (discordAwaitingPlayback || !settings.discordEnabled || !track || statusSuppressed || st.status === 'idle' || st.status === 'error') {
      await invoke('discord_clear_presence');
      return;
    }
    const artwork = bestThumbnail(track.thumbnails, 512);
    await invoke('discord_set_presence', {
      payload: {
        title: track.title,
        videoId: track.videoId,
        artist: track.artists.map((a) => a.name).join(', ') || 'Unknown artist',
        album: track.album?.name ?? '',
        artwork,
        isPlaying: st.status === 'playing',
      isLoading: st.status === 'loading',
        // Loading is neither playing nor paused, so the paused marker doesn't
        // flash between tracks.
        isPaused: st.status === 'paused',
        positionSecs: Math.round(st.positionSeconds),
        durationSecs: Math.round(st.durationSeconds || track.durationSeconds || 0),
        statusDisplay: settings.discordStatusDisplay,
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cherry] discord presence failed:', e);
  }
}

/** Configure the Discord application id (Settings → Integrations). */
export async function setDiscordAppId(appId: string): Promise<{ configured: boolean }> {
  try {
    const { invoke } = await import('$lib/desktop/core');
    return await invoke<{ configured: boolean }>('discord_set_app_id', { appId });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cherry] discord_set_app_id failed:', e);
    return { configured: false };
  }
}

/**
 * Keep presence alive.
 *
 * Discord only accepts a connection while it is running, so a push at track
 * change can fail silently if Discord was closed (or started later). This
 * retries periodically while a track is loaded, which makes presence work for
 * the whole session rather than once.
 */
let presenceTimer: ReturnType<typeof setInterval> | null = null;
let mediaTimer: ReturnType<typeof setInterval> | null = null;
export function startPresenceKeepAlive(): void {
  if (presenceTimer) return;
  presenceTimer = setInterval(() => {
    queueDiscord();
  }, 15000);
  // Windows does not advance the SMTC timeline itself, so the taskbar preview
  // and Action Center scrubber need periodic position updates while playing.
  if (!mediaTimer) {
    mediaTimer = setInterval(() => {
      const st = get(playerStore);
      if (st.status === 'playing' && st.track) void pushMediaState();
    }, 5000);
  }
}

/** Called when the settings toggle or app id changes. */
export async function refreshDiscord(): Promise<void> {
  // Bypass the coalescing gap: a settings change should take effect at once.
  if (discordTimer) {
    clearTimeout(discordTimer);
    discordTimer = null;
  }
  discordLastPush = 0;
  await flushDiscord();
}
