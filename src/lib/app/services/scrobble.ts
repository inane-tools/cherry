// Scrobble accounting.
//
// Last.fm's rules: a track longer than 30 s is scrobbled once it has been played
// for at least half its length, or 4 minutes, whichever comes first. Playback
// time is measured as wall time while the player reports `playing` (a seek does
// not count as listening), and the scrobble's timestamp is when the track
// started.
//
// Failed scrobbles (offline, Last.fm down) are queued in localStorage and
// retried, so a play is not silently lost. The scrobble is *not* marked done
// until it is accepted.

import { get } from 'svelte/store';
import type { PlaybackState, Track } from '$lib/core/models';
import { playerStore } from './player';
import { settingsStore } from './settings';
import { fieldsFromTrack, lastfmActive, nowPlaying, scrobble, type ScrobbleFields } from './lastfm';

/** Last.fm's own cap: never wait longer than 4 minutes. */
const THRESHOLD_CAP_SECONDS = 240;
/** Fallbacks when an older settings file predates these options. */
const DEFAULT_MIN_DURATION_SECONDS = 30;
const DEFAULT_SCROBBLE_PERCENT = 50;

/**
 * Longest gap between two accounting points that still counts as listening.
 * A hidden, inaudible page gets Chromium's intensive timer throttling, which
 * wakes timers about once a minute, so ticks can be ~60 s apart. A much longer
 * gap means the machine slept or the clock jumped, and is not counted.
 */
const MAX_GAP_MS = 90_000;
/** How often the offline queue is retried. */
const FLUSH_INTERVAL_MS = 60_000;

const QUEUE_KEY = 'cherry.scrobble.queue.v1';
const MAX_QUEUE = 100;

interface PendingScrobble {
  fields: ScrobbleFields;
  timestamp: number;
}

function loadQueue(): PendingScrobble[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingScrobble[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: PendingScrobble[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
  } catch {
    /* ignore */
  }
}

function enqueue(item: PendingScrobble): void {
  const queue = loadQueue();
  queue.push(item);
  saveQueue(queue);
}

function sameScrobble(a: PendingScrobble, b: PendingScrobble): boolean {
  return (
    a.timestamp === b.timestamp &&
    a.fields.artist === b.fields.artist &&
    a.fields.track === b.fields.track
  );
}

let flushing: Promise<void> | null = null;

/**
 * Retry anything queued while offline. Called periodically and at startup.
 *
 * Concurrency: the periodic flush and the startup flush can overlap, and a new
 * failed scrobble can be enqueued while a flush is awaiting Last.fm. So only
 * one flush runs at a time, and on completion it removes exactly the items it
 * sent from the *current* stored queue — overwriting the queue with the list it
 * read at the start used to silently drop anything enqueued meanwhile.
 */
export function flushScrobbleQueue(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    if (!lastfmActive()) return;
    const snapshot = loadQueue();
    if (snapshot.length === 0) return;
    const sent: PendingScrobble[] = [];
    for (const item of snapshot) {
      if (await scrobble(item.fields, item.timestamp)) sent.push(item);
    }
    if (sent.length === 0) return;
    saveQueue(loadQueue().filter((item) => !sent.some((done) => sameScrobble(done, item))));
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

let currentVideoId: string | null = null;
let currentTrack: Track | null = null;
let currentDuration = 0;
let startedAt = 0;
let listenedMs = 0;
let scrobbled = false;
let wasPlaying = false;
let lastPosition = 0;
/** Wall-clock time listening was last accounted up to; null while not playing. */
let countingSince: number | null = null;
let lastFlushAt = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Add the wall time since the last accounting point to the current track.
 *
 * Listening time is measured from wall-clock deltas, not by counting 1 s
 * interval ticks: a throttled background page fires far fewer ticks than
 * seconds pass, so counting ticks let long tracks never reach the threshold.
 */
function accrue(now: number): void {
  if (countingSince !== null) {
    const gap = now - countingSince;
    if (gap > 0 && gap <= MAX_GAP_MS) listenedMs += gap;
  }
  countingSince = wasPlaying ? now : null;
}

function beginTrack(track: Track, state: PlaybackState): void {
  currentVideoId = track.videoId;
  currentTrack = track;
  // The timestamp is when the track started, not when the app noticed it; a
  // restored/resumed track has already been playing for `positionSeconds`.
  const position = Math.max(0, Math.round(state.positionSeconds || 0));
  startedAt = Math.floor(Date.now() / 1000) - position;
  listenedMs = 0;
  scrobbled = false;
}

function onState(state: PlaybackState): void {
  // Credit the time since the last tick to the track that was playing, and
  // check it before switching: with throttled ticks a track can cross its
  // threshold and end before the next tick runs.
  accrue(Date.now());
  if (currentTrack) maybeScrobble(currentTrack, currentDuration);
  const track = state.track;
  if (!track) {
    currentVideoId = null;
    currentTrack = null;
    currentDuration = 0;
    lastPosition = 0;
    wasPlaying = false;
    countingSince = null;
    return;
  }
  // A new track — or the same track starting over after it was already
  // scrobbled (repeat-one, or replaying it), which Last.fm counts as a new play.
  // Seeking back before the scrobble point does not reset the listened time.
  const position = state.positionSeconds || 0;
  const restarted = scrobbled && position < 3 && lastPosition - position > 10;
  const changed = track.videoId !== currentVideoId || restarted;
  if (changed) {
    beginTrack(track, state);
  }
  lastPosition = position;
  currentTrack = track;
  currentDuration = state.durationSeconds || track.durationSeconds || 0;
  const playing = state.status === 'playing';
  // A restored queue begins the track paused at launch; date the play from
  // when listening actually starts, not from when the app opened.
  if (playing && !wasPlaying && listenedMs === 0 && !scrobbled) {
    startedAt = Math.floor(Date.now() / 1000) - Math.max(0, Math.round(position));
  }
  // Send "now playing" on the transition into playing (and on a fresh track).
  if (playing && (changed || !wasPlaying) && (get(settingsStore).lastfmNowPlaying ?? true)) {
    void nowPlaying(track);
  }
  wasPlaying = playing;
  countingSince = playing ? Date.now() : null;
}

function tick(): void {
  const now = Date.now();
  accrue(now);
  if (currentTrack) maybeScrobble(currentTrack, currentDuration);
  if (now - lastFlushAt >= FLUSH_INTERVAL_MS) {
    lastFlushAt = now;
    void flushScrobbleQueue();
  }
}

function maybeScrobble(track: Track, duration: number): void {
  if (scrobbled || !lastfmActive()) return;
  const s = get(settingsStore);
  const minDuration = s.lastfmMinDurationSeconds ?? DEFAULT_MIN_DURATION_SECONDS;
  if (!duration || duration < minDuration) return;
  const percent = Math.min(100, Math.max(1, s.lastfmScrobblePercent ?? DEFAULT_SCROBBLE_PERCENT));
  const threshold = Math.min((duration * percent) / 100, THRESHOLD_CAP_SECONDS);
  if (listenedMs < threshold * 1000) return;
  scrobbled = true;
  const fields = fieldsFromTrack(track);
  const timestamp = startedAt;
  void scrobble(fields, timestamp).then((ok) => {
    if (!ok) enqueue({ fields, timestamp });
  });
}

/** Test hook: reset the per-track accounting. */
export function resetScrobbleState(): void {
  currentVideoId = null;
  currentTrack = null;
  currentDuration = 0;
  startedAt = 0;
  listenedMs = 0;
  scrobbled = false;
  wasPlaying = false;
  lastPosition = 0;
  countingSince = null;
  lastFlushAt = 0;
}

/** Exposed for tests: feed one player state / run one accounting tick. */
export const __test = { onState, tick };

/** Start accounting. Safe to call once at startup. */
export function startScrobbling(): void {
  if (timer) return;
  playerStore.subscribe(onState);
  timer = setInterval(tick, 1000);
  lastFlushAt = Date.now();
  void flushScrobbleQueue();
}
