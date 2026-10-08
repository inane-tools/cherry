// Queue persistence: remember what was playing so a restart resumes the same
// queue, track and position instead of coming back empty.
//
// Stored in `localStorage` (JSON) rather than the settings store: it is
// throwaway session state, it can be large for a long queue, and it must be easy
// to drop when the user signs out or clears data. Nothing here is secret.

import { get } from 'svelte/store';
import type { QueueItem, RepeatMode } from '$lib/core/models';
import {
  currentOrder,
  queueIndex,
  queueItems,
  repeatMode,
  shuffleMode,
  setQueueState,
} from './queue';

const STORAGE_KEY = 'cherry.queue.v1';
/** A queue can be long; cap what we are willing to persist. */
const MAX_ITEMS = 2000;

export interface PersistedQueue {
  items: QueueItem[];
  index: number;
  order: number[];
  shuffle: boolean;
  repeat: RepeatMode;
  /** Playback position of the current track, in seconds. */
  position: number;
}

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPosition = 0;

/**
 * Throttled writer: schedule a write at most once per `SAVE_INTERVAL_MS`.
 *
 * This must NOT be a resetting debounce. `timeupdate` fires every ~250 ms while
 * playing, so a debounce whose timer is cleared on each change would never fire
 * during continuous playback — the stored position stayed at 0 forever (the
 * "scrubber does not remember the position" bug).
 */
const SAVE_INTERVAL_MS = 1000;

function scheduleSave(): void {
  if (saveTimer) return; // a write is already pending; it will pick up the latest values
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeNow();
  }, SAVE_INTERVAL_MS);
}

/** Write immediately (used on exit, where a pending timer would be lost). */
export function flushQueue(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  writeNow();
}

/**
 * The queue to store, at most `MAX_ITEMS` long and always self-consistent.
 *
 * Slicing only `items` (as before) left `order`/`index` describing the full
 * queue, so a restore with shuffle on fell back to list order at a clamped
 * position. Over the cap, store the play sequence from the current track on,
 * already in play order (identity `order`, index 0).
 */
export function boundedQueue(
  items: QueueItem[],
  index: number,
  order: number[],
): Pick<PersistedQueue, 'items' | 'index' | 'order'> {
  if (items.length <= MAX_ITEMS) return { items, index, order };
  const sequence =
    order.length === items.length ? order.map((i) => items[i]).filter(Boolean) : items;
  const from = Math.max(0, index);
  const kept = sequence.slice(from, from + MAX_ITEMS);
  return { items: kept, index: 0, order: kept.map((_, i) => i) };
}

function writeNow(): void {
  const ls = store();
  if (!ls) return;
  const items = get(queueItems);
  if (items.length === 0) {
    try {
      ls.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  const payload: PersistedQueue = {
    ...boundedQueue(items, get(queueIndex), currentOrder()),
    shuffle: get(shuffleMode),
    repeat: get(repeatMode),
    position: Math.max(0, Math.round(pendingPosition)),
  };
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota: the queue simply does not survive this restart */
  }
}

/** Record the live position; the queue itself is captured on `saveQueue`. */
export function rememberPosition(seconds: number): void {
  pendingPosition = seconds;
  scheduleSave();
}

/** Persist the queue now (called whenever order/shuffle/repeat/items change). */
export function saveQueue(): void {
  scheduleSave();
}

let watching = false;

/**
 * Save the queue whenever it changes (items, position in the queue, shuffle,
 * repeat). Started once from the app shell; `queue.ts` deliberately does not
 * import this module, so the dependency only points one way.
 *
 * The *current* value each store emits on subscribe is skipped: otherwise the
 * first (empty) emission would schedule a write that could race the startup
 * restore and wipe the very queue we are about to read back.
 */
export function watchQueue(): void {
  if (watching) return;
  watching = true;
  const onChange = () => saveQueue();
  const watch = <T>(store: { subscribe: (fn: (value: T) => void) => () => void }) => {
    let first = true;
    store.subscribe(() => {
      if (first) {
        first = false;
        return;
      }
      onChange();
    });
  };
  watch(queueItems);
  watch(queueIndex);
  watch(shuffleMode);
  watch(repeatMode);

  // Flush on the way out so a quit right after a change (before the throttle
  // fires) does not lose the position.
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flushQueue);
    window.addEventListener('pagehide', flushQueue);
  }
}

/** Read the stored queue, if any (does not mutate anything). */
export function readStoredQueue(): PersistedQueue | null {
  const ls = store();
  if (!ls) return null;
  try {
    const raw = ls.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedQueue;
    if (!Array.isArray(parsed?.items) || parsed.items.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Restore the stored queue into the queue stores. Returns the position to seek
 * to, or `null` when there was nothing to restore.
 */
export function restoreQueue(): number | null {
  const saved = readStoredQueue();
  if (!saved) return null;
  setQueueState({
    items: saved.items,
    index: saved.index,
    order: saved.order,
    shuffle: saved.shuffle,
    repeat: saved.repeat,
  });
  return Math.max(0, saved.position ?? 0);
}

/** Forget the stored queue (sign-out / clear data). */
export function clearStoredQueue(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pendingPosition = 0;
  const ls = store();
  if (!ls) return;
  try {
    ls.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
