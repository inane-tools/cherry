// Player service: owns the single <audio> element, stream resolution,
// OS integration (media keys metadata via Rust, Discord presence).
//
// Flow: playTrack(s) → queue.setQueue → loadCurrent() → Innertube stream URL
// → audio.src → play. Autoplay advances via queue.step().

import { get, writable } from 'svelte/store';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { PlaybackState, Track } from '$lib/core/models';
import { bestThumbnail, trackDisplayArtists } from '$lib/core/models';
import { toCherryError } from '$lib/core/errors';
import { getAudioStream, getInnertube } from '$lib/infra/ytmusic/InnertubeClient';
import { authStore } from './auth';
import { currentItem, queueStore, setQueue, step, setRepeat, setShuffle, moveTo } from './queue';
import { invokeSafe, isTauri } from './platform';
import { announceSignInRequired } from './gate';
import { settingsStore, updateSettings } from './settings';
import { rememberPosition, restoreQueue, watchQueue } from './queuePersistence';
import { applyArtworkTheme, resetArtworkTheme } from './theme';

export const playerStore = writable<PlaybackState>({
  status: 'idle',
  track: null,
  positionSeconds: 0,
  durationSeconds: 0,
  volume: 0.8,
  muted: false,
});

let audio: HTMLAudioElement | null = null;
let sessionUnsub: (() => void) | null = null;
let queueUnsub: (() => void) | null = null;
let lastStreamVideoId: string | null = null;
/**
 * Position to seek to once the restored track's stream loads. Scoped to the
 * track it belongs to (and cleared on any load) so it can never be applied to a
 * different song the user starts first.
 */
let pendingResume: { videoId: string; seconds: number } | null = null;
// Discord presence is coalesced (see queueDiscord): Discord drops SET_ACTIVITY
// updates beyond 5 per 20 s, which used to leave presence stuck on a stale
// track when skipping/scrubbing quickly.
const DISCORD_MIN_GAP_MS = 4100;
let discordLastPush = 0;
let discordTimer: ReturnType<typeof setTimeout> | null = null;
let discordDirty = false;
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
    void invokeSafe('media_cleared');
    void invokeSafe('discord_clear_presence');
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

function ensureAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'auto';
    const s = get(playerStore);
    audio.volume = s.volume;
    audio.muted = s.muted;
    audio.addEventListener('timeupdate', () => {
      playerStore.update((p) => ({ ...p, positionSeconds: audio?.currentTime ?? 0 }));
      // Remember the position so a restart resumes where the user left off.
      rememberPosition(audio?.currentTime ?? 0);
    });
    audio.addEventListener('loadedmetadata', () => {
      playerStore.update((p) => ({
        ...p,
        durationSeconds: Number.isFinite(audio?.duration ?? NaN) ? (audio?.duration ?? 0) : p.durationSeconds,
      }));
    });
    audio.addEventListener('play', () => {
      playerStore.update((p) => ({ ...p, status: 'playing', error: undefined }));
      cancelPauseClear();
      // Force: resume must reach Discord immediately, including fresh timers.
      void pushOsState();
    });
    audio.addEventListener('pause', () => {
      // Any pause counts, not just one that interrupted "playing" — otherwise a
      // pause during buffering left the presence looking like it was still on.
      playerStore.update((p) => (p.track ? { ...p, status: 'paused' } : p));
      schedulePauseClear();
      void pushOsState();
    });
    audio.addEventListener('ended', () => void onEnded());
    audio.addEventListener('error', () => {
      // Releasing the element in stopPlayback() can emit an "empty src" error;
      // ignore it so tearing down never resurrects a stale track.
      if (!audio?.getAttribute('src')) return;
      playerStore.update((p) => ({ ...p, status: 'error', error: 'Playback failed for this track.' }));
      void pushOsState();
    });
  }
  return audio;
}

/**
 * Seek to the remembered position once the media is seekable.
 *
 * A restored queue shows the previous track paused at its last position; the
 * seek can only be applied after metadata loads, and must be applied exactly
 * once, only to the track it was saved for.
 */
function applyPendingResume(el: HTMLAudioElement, videoId: string): void {
  const resume = pendingResume;
  pendingResume = null;
  if (!resume || resume.videoId !== videoId) return;
  const target = resume.seconds;
  const seek = () => {
    // Guard against a bogus remembered position (e.g. longer than the track).
    const max = Number.isFinite(el.duration) && el.duration > 0 ? Math.max(0, el.duration - 1) : target;
    el.currentTime = Math.min(target, max);
    playerStore.update((p) => ({ ...p, positionSeconds: el.currentTime }));
  };
  if (el.readyState >= 1) seek();
  else el.addEventListener('loadedmetadata', seek, { once: true });
}

async function onEnded(): Promise<void> {
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
    if (!isTauri()) return;
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
  if (st.status === 'playing') {
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
  if (!moveTo(queueId)) return;
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
  if (!el.getAttribute('src')) {
    const track = get(playerStore).track;
    if (track) pendingResume = { videoId: track.videoId, seconds: target };
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
  playerStore.update((p) => ({
    ...p,
    status: 'paused',
    track: item.track,
    positionSeconds: position,
    durationSeconds: item.track.durationSeconds ?? 0,
  }));
  // A paused UI needs a real source before it can seek; the stream is resolved
  // lazily by `toggle()`, so hold the position and apply it on load instead.
  pendingResume = position > 0 ? { videoId: item.track.videoId, seconds: position } : null;
  // Record it too: otherwise the next queue save would persist position 0 and
  // quitting without pressing play would lose where the user was.
  rememberPosition(position);
  void applyArtworkTheme(bestThumbnail(item.track.thumbnails, 256));
  // Clear any stale OS presence from a previous run; the card is re-pushed when
  // playback actually starts.
  await pushOsState();
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

async function loadCurrent(autoplay: boolean): Promise<void> {
  cancelPauseClear();
  const item = get(currentItem);
  const el = ensureAudio();
  if (!item) {
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
    track: item.track,
    positionSeconds: 0,
    durationSeconds: item.track.durationSeconds ?? 0,
    error: undefined,
  }));
  // Theme the app from the new track's artwork (fire and forget).
  void applyArtworkTheme(bestThumbnail(item.track.thumbnails, 256));
  await pushOsState();
  try {
    // Gate again here: autoplay can advance into this after a sign-out.
    if (!get(authStore)) {
      playerStore.update((p) => ({ ...p, status: 'idle', track: null }));
      await pushOsState();
      announceSignInRequired();
      return;
    }
    const session = get(authStore);
    const { track, stream } = await getAudioStream(item.track.videoId, session);
    // Guard: user skipped while we were resolving.
    if (get(currentItem)?.track.videoId !== item.track.videoId) return;
    lastStreamVideoId = item.track.videoId;
    el.src = stream.url;
    applyPendingResume(el, item.track.videoId);
    if (track.durationSeconds) {
      playerStore.update((p) => ({ ...p, durationSeconds: track.durationSeconds as number }));
    }
    if (autoplay) await el.play();
  } catch (e) {
    const err = toCherryError(e);
    // If the stream URL expired (410-ish), retry once with a fresh client.
    if (lastStreamVideoId !== item.track.videoId + ':retry') {
      lastStreamVideoId = item.track.videoId + ':retry';
      try {
        const session = get(authStore);
        const { stream } = await getAudioStream(item.track.videoId, session);
        el.src = stream.url;
        applyPendingResume(el, item.track.videoId);
        if (autoplay) await el.play().catch(() => undefined);
        return;
      } catch {
        /* fall through to error state */
      }
    }
    playerStore.update((p) => ({ ...p, status: 'error', error: err.message }));
    await pushOsState();
  }
}

// ── OS integration ──────────────────────────────────────────────

async function pushMediaState(): Promise<void> {
  // A long pause already cleared the status; don't re-advertise it.
  if (statusSuppressed) return;
  const st = get(playerStore);
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
    },
  });
}

async function pushOsState(): Promise<void> {
  await pushMediaState();
  queueDiscord();
}

/**
 * Ask for a Discord presence update.
 *
 * Updates are coalesced to one per `DISCORD_MIN_GAP_MS` and always send the
 * *current* player state, so a burst of changes (skipping tracks, scrubbing)
 * converges on the right track instead of being dropped by Discord's
 * SET_ACTIVITY rate limit and leaving the presence stuck.
 */
function queueDiscord(): void {
  // A long pause already cleared the presence; the keep-alive must not bring
  // it back while the same track is merely paused.
  if (statusSuppressed) return;
  discordDirty = true;
  if (discordTimer) return;
  const wait = Math.max(0, DISCORD_MIN_GAP_MS - (Date.now() - discordLastPush));
  discordTimer = setTimeout(() => {
    discordTimer = null;
    if (discordDirty) void flushDiscord();
  }, wait);
}

async function flushDiscord(): Promise<void> {
  discordDirty = false;
  discordLastPush = Date.now();
  const st = get(playerStore);
  const settings = get(settingsStore);
  const track = st.track;
  if (!settings.discordEnabled || !track) {
    await invokeSafe('discord_clear_presence');
    return;
  }
  // A long pause already cleared the presence; don't re-advertise a track that
  // is only paused. (Disabling Discord above still clears it.)
  if (statusSuppressed) return;
  const artwork = bestThumbnail(track.thumbnails, 512);
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('discord_set_presence', {
      payload: {
        title: track.title,
        artist: track.artists.map((a) => a.name).join(', ') || 'Unknown artist',
        album: track.album?.name ?? '',
        artwork,
        isPlaying: st.status === 'playing',
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
    const { invoke } = await import('@tauri-apps/api/core');
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
    if (!get(playerStore).track) return;
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
