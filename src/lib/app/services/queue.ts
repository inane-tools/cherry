// Queue service: owns order, shuffle, repeat. The player service owns the
// <audio> element and asks the queue what to play next.

import { derived, get, writable } from 'svelte/store';
import type { QueueItem, RepeatMode, Track } from '$lib/core/models';

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const items = writable<QueueItem[]>([]);
const index = writable<number>(-1);
const repeat = writable<RepeatMode>('off');
const shuffleOn = writable<boolean>(false);
// When shuffle is on, `order` maps play-position → items index.
const order = writable<number[]>([]);

export const queueStore = { items, index, repeat, shuffle: shuffleOn };
// Named re-exports so Svelte components can auto-subscribe ($repeatMode, …).
// (`$queueStore.repeat` is NOT subscribable — auto-subscription only works on
// top-level store variables.)
export const queueItems = items;
export const queueIndex = index;
export const repeatMode = repeat;
export const shuffleMode = shuffleOn;
export const currentItem = derived([items, index, order, shuffleOn], ([$items, $index, $order, $sh]) => {
  if ($items.length === 0 || $index < 0) return null;
  if ($sh) {
    const mapped = $order[$index];
    return mapped == null ? null : ($items[mapped] ?? null);
  }
  return $items[$index] ?? null;
});
export const upNext = derived([items, index, order, shuffleOn], ([$items, $index, $order, $sh]) => {
  if ($items.length === 0) return [];
  const seq = $sh ? $order.map((i) => $items[i]).filter(Boolean) : $items;
  return seq.slice($index + 1, $index + 11);
});

function rebuildOrder(n: number, keepFirst?: number): void {
  if (n === 0) {
    order.set([]);
    return;
  }
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => i !== keepFirst);
  const tail = get(shuffleOn) ? shuffled(rest) : rest;
  order.set(keepFirst == null ? tail : [keepFirst, ...tail]);
}

export function setQueue(tracks: Track[], startAt = 0): void {
  const list = tracks.map((track) => ({ track, queueId: uid() }));
  items.set(list);
  const clamped = Math.max(0, Math.min(startAt, list.length - 1));
  if (get(shuffleOn)) {
    rebuildOrder(list.length, list.length ? clamped : undefined);
    index.set(0);
  } else {
    order.set(list.map((_, i) => i));
    index.set(list.length ? clamped : -1);
  }
}

export function enqueue(tracks: Track[], playNext = false): void {
  if (tracks.length === 0) return;
  const list = get(items);
  const additions = tracks.map((track) => ({ track, queueId: uid() }));
  if (list.length === 0) {
    setQueue(tracks, 0);
    return;
  }
  const at = get(index);
  const next = [...list];
  next.splice(playNext ? at + 1 : next.length, 0, ...additions);
  items.set(next);
  rebuildOrder(next.length);
  // keep current position stable
  const cur = get(currentItem);
  if (cur) {
    const pos = next.findIndex((i) => i.queueId === cur.queueId);
    index.set(get(shuffleOn) ? get(order).indexOf(pos) : pos);
  }
}

export function clearQueue(): void {
  items.set([]);
  index.set(-1);
  order.set([]);
}

export function moveTo(queueId: string): boolean {
  const list = get(items);
  const pos = list.findIndex((i) => i.queueId === queueId);
  if (pos < 0) return false;
  if (get(shuffleOn)) {
    const o = get(order);
    index.set(o.indexOf(pos));
  } else {
    index.set(pos);
  }
  return true;
}

/**
 * Move the play position by `dir`.
 *
 * `ignoreRepeatOne` is for a manual skip: pressing Next while repeat-one is on
 * must advance to the next track, whereas an automatic advance replays the
 * current one (the caller handles that by not stepping at all).
 */
export function step(dir: 1 | -1, ignoreRepeatOne = false): boolean {
  const list = get(items);
  if (list.length === 0) return false;
  if (!ignoreRepeatOne && get(repeat) === 'one' && dir === 1) return true; // caller replays current
  let next = get(index) + dir;
  if (next < 0) {
    if (get(repeat) === 'all') next = list.length - 1;
    else return false;
  }
  if (next >= list.length) {
    if (get(repeat) === 'all') next = 0;
    else return false;
  }
  index.set(next);
  return true;
}

export function setRepeat(mode: RepeatMode): void {
  repeat.set(mode);
}

/**
 * Replace the whole queue state at once (used when restoring a persisted queue).
 *
 * Writes the stores directly rather than replaying `setQueue`/`setShuffle`, so
 * the restored order, shuffle flag and position are exactly what was saved.
 */
export function setQueueState(state: {
  items: QueueItem[];
  index: number;
  order: number[];
  shuffle: boolean;
  repeat: RepeatMode;
}): void {
  const count = state.items.length;
  items.set(state.items);
  repeat.set(state.repeat);
  shuffleOn.set(count > 0 && state.shuffle);
  // Rebuild a valid order when the saved one is missing/short (older payloads).
  const restoredOrder =
    Array.isArray(state.order) && state.order.length === count
      ? state.order
      : state.items.map((_, i) => i);
  order.set(restoredOrder);
  index.set(count > 0 ? Math.max(0, Math.min(state.index, count - 1)) : -1);
}

/** Current play order, for persistence. */
export function currentOrder(): number[] {
  return get(order);
}

export function setShuffle(on: boolean): void {
  const was = get(shuffleOn);
  if (was === on) return;
  shuffleOn.set(on);
  const cur = get(currentItem);
  const list = get(items);
  if (on) {
    const curPos = cur ? list.findIndex((i) => i.queueId === cur.queueId) : -1;
    rebuildOrder(list.length, curPos >= 0 ? curPos : undefined);
    index.set(0);
  } else {
    const pos = cur ? list.findIndex((i) => i.queueId === cur.queueId) : -1;
    order.set(list.map((_, i) => i));
    index.set(pos);
  }
}
