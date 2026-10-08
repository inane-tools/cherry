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
let startedAt = 0;
let listenedSeconds = 0;
let scrobbled = false;
let wasPlaying = false;
let lastPosition = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let tickCount = 0;

function beginTrack(track: Track, state: PlaybackState): void {
  currentVideoId = track.videoId;
  // The timestamp is when the track started, not when the app noticed it; a
  // restored/resumed track has already been playing for `positionSeconds`.
  const position = Math.max(0, Math.round(state.positionSeconds || 0));
  startedAt = Math.floor(Date.now() / 1000) - position;
  listenedSeconds = 0;
  scrobbled = false;
}

function onState(state: PlaybackState): void {
  const track = state.track;
  if (!track) {
    currentVideoId = null;
    lastPosition = 0;
    wasPlaying = false;
    return;
  }
  // A new track — or the same track starting over after it was already
  // scrobbled (repeat-one, or replaying it), which Last.fm counts as a new play.
  // Seeking back before the scrobble point does not reset the listened time.
  const position = state.positionSeconds || 0;
  const restarted = scrobbled && position < 3 && lastPosition - position > 10;
  if (track.videoId !== currentVideoId || restarted) {
    beginTrack(track, state);
  }
  lastPosition = position;
  const playing = state.status === 'playing';
  // Send "now playing" on the transition into playing (and on a fresh track).
  if (playing && !wasPlaying && (get(settingsStore).lastfmNowPlaying ?? true)) {
    void nowPlaying(track);
  }
  wasPlaying = playing;
}

function tick(): void {
  const state = get(playerStore);
  if (state.status === 'playing' && state.track) {
    listenedSeconds += 1;
    maybeScrobble(state.track, state.durationSeconds || state.track.durationSeconds || 0);
  }
  tickCount += 1;
  if (tickCount % 60 === 0) void flushScrobbleQueue();
}

function maybeScrobble(track: Track, duration: number): void {
  if (scrobbled || !lastfmActive()) return;
  const s = get(settingsStore);
  const minDuration = s.lastfmMinDurationSeconds ?? DEFAULT_MIN_DURATION_SECONDS;
  if (!duration || duration < minDuration) return;
  const percent = Math.min(100, Math.max(1, s.lastfmScrobblePercent ?? DEFAULT_SCROBBLE_PERCENT));
  const threshold = Math.min((duration * percent) / 100, THRESHOLD_CAP_SECONDS);
  if (listenedSeconds < threshold) return;
  scrobbled = true;
  const fields = fieldsFromTrack(track);
  void scrobble(fields, startedAt).then((ok) => {
    if (!ok) enqueue({ fields, timestamp: startedAt });
  });
}

/** Test hook: reset the per-track accounting. */
export function resetScrobbleState(): void {
  currentVideoId = null;
  startedAt = 0;
  listenedSeconds = 0;
  scrobbled = false;
  wasPlaying = false;
  lastPosition = 0;
}

/** Exposed for tests: feed one player state / one second of wall time. */
export const __test = { onState, tick };

/** Start accounting. Safe to call once at startup. */
export function startScrobbling(): void {
  if (timer) return;
  playerStore.subscribe(onState);
  timer = setInterval(tick, 1000);
  void flushScrobbleQueue();
}
