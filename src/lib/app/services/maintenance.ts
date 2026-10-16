// Settings maintenance: cached responses live in the renderer; Chromium's
// caches, login partition and encrypted credentials belong to the main process.
import { cacheClear } from '$lib/infra/storage/cache';
import { flushSettings } from '$lib/infra/storage/settingsRepo';
import { invokeSafe, invokeStrict, isDesktop } from './platform';
import { resetInnertubeClient } from '$lib/infra/ytmusic/InnertubeClient';

export interface ClearResult {
  removed: string[];
  locked: string[];
}

/** Approximate bytes of the entire Electron profile, not just the HTTP cache. */
export async function formatCacheSize(): Promise<string> {
  if (!isDesktop()) return 'unknown';
  const bytes = await invokeSafe<number>('cache_size');
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function bounded<T>(promise: Promise<T>, ms = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Storage is busy')), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** Empty the player cache without deleting a database that youtubei keeps open. */
async function clearPlayerCache(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  if (indexedDB.databases && !(await indexedDB.databases()).some(db => db.name === 'youtubei.js')) return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('youtubei.js');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Player cache is busy'));
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv-store')) { db.close(); resolve(); return; }
      const tx = db.transaction('kv-store', 'readwrite');
      tx.objectStore('kv-store').clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}

/** Preserve sign-in, preferences, saved queue and Last.fm when clearing caches. */
export async function clearCache(): Promise<ClearResult> {
  cacheClear();
  resetInnertubeClient();
  const result: ClearResult = { removed: ['playlist cache'], locked: [] };
  for (const [name, run] of [
    ['player cache', clearPlayerCache],
    ['web caches', async () => {
      if (typeof caches === 'undefined') return;
      const deleted = await Promise.all((await caches.keys()).map(key => caches.delete(key)));
      if (deleted.some(value => !value)) throw new Error('Cache deletion failed');
    }],
  ] as const) {
    try { await bounded(run()); result.removed.push(name); }
    catch { result.locked.push(name); }
  }
  if (isDesktop()) {
    const native = await invokeStrict<ClearResult>('clear_cache');
    result.removed.push(...native.removed);
    result.locked.push(...native.locked);
  }
  return result;
}

export async function clearAllData(): Promise<ClearResult> {
  // Finish pending settings saves before the main process freezes writes and wipes.
  await flushSettings();
  cacheClear();
  resetInnertubeClient();
  localStorage.clear();
  sessionStorage.clear();
  if (!isDesktop()) return clearCache();
  const entries = await invokeStrict<string[]>('clear_local_data');
  return {
    removed: entries.filter(entry => !entry.startsWith('locked:')),
    locked: entries.filter(entry => entry.startsWith('locked:')).map(entry => entry.slice(7)),
  };
}
