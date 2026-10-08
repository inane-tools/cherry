// Settings → "Clear data and cache".
//
// Clearing has to touch three layers, because "cache" for Cherry spans all of
// them:
//  1. in-page storage — youtubei.js's IndexedDB cache, the app's
//     `localStorage`/`sessionStorage` and service-worker caches (cleared here);
//  2. the on-disk WebView2 profile + settings store (cleared in Rust);
//  3. the keychain session (cleared in Rust via `auth_clear`).

import { cacheClear } from '$lib/infra/storage/cache';
import { invokeSafe, isTauri } from './platform';
import { resetInnertubeClient } from '$lib/infra/ytmusic/InnertubeClient';

export interface ClearResult {
  /** Human-readable list of what was removed. */
  removed: string[];
  /** Anything the OS refused to release while the app was running. */
  locked: string[];
}

/** Approximate size of the on-disk app data, formatted for display. */
export async function formatCacheSize(): Promise<string> {
  if (!isTauri()) return 'unknown';
  const bytes = await invokeSafe<number>('cache_size');
  if (bytes === null) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Resolve `promise`, or `fallback` if it takes longer than `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: T) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    setTimeout(() => finish(fallback), ms);
    promise.then(finish, () => finish(fallback));
  });
}

/**
 * Delete every in-page cache. Safe to call whether or not we are in Tauri.
 *
 * Every step is independently guarded and time-boxed: `indexedDB.deleteDatabase`
 * fires `onblocked` (and never `onsuccess`) while youtubei.js still holds a
 * connection, which would otherwise hang the whole "Clear data" action.
 */
async function clearInPageCaches(): Promise<void> {
  cacheClear();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
  try {
    if (typeof caches !== 'undefined') {
      const keys = await withTimeout(caches.keys(), 2000, []);
      await withTimeout(Promise.all(keys.map((key) => caches.delete(key))), 2000, []);
    }
  } catch {
    /* ignore */
  }
  try {
    // youtubei.js stores its persistent cache in IndexedDB.
    if (typeof indexedDB !== 'undefined' && indexedDB.databases) {
      const dbs = await withTimeout(indexedDB.databases(), 2000, []);
      await withTimeout(
        Promise.all(
          dbs.map(
            (db) =>
              new Promise<void>((resolve) => {
                if (!db.name) return resolve();
                const req = indexedDB.deleteDatabase(db.name);
                req.onsuccess = req.onerror = req.onblocked = () => resolve();
                // `onblocked` can fire without ever settling; the outer timeout
                // covers that case.
              }),
          ),
        ),
        4000,
        [],
      );
    }
  } catch {
    /* ignore */
  }
}

/**
 * Drop the cached playlist/library data (and the Innertube client that reads
 * it), leaving settings, the signed-in session and the WebView profile intact.
 */
export async function clearCache(): Promise<ClearResult> {
  cacheClear();
  resetInnertubeClient();
  return { removed: ['playlist cache'], locked: [] };
}

/**
 * Clear everything Cherry stores locally.
 *
 * The in-page caches are dropped first so the running app stops reading them
 * immediately; the Rust side then removes the settings store and any on-disk
 * caches it can get at.
 */
export async function clearAllData(): Promise<ClearResult> {
  await clearInPageCaches();
  resetInnertubeClient();

  let removed: string[] = [];
  if (isTauri()) {
    const result = await invokeSafe<string[]>('clear_local_data');
    removed = result ?? [];
  }

  const locked = removed
    .filter((entry) => entry.startsWith('locked:'))
    .flatMap((entry) =>
      entry
        .slice('locked:'.length)
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
    );
  return { removed: removed.filter((entry) => !entry.startsWith('locked:')), locked };
}
