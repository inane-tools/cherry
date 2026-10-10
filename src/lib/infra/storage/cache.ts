// Small TTL cache used to cut repeated YouTube requests.
//
// Two tiers:
//  - memory: fast path, bounded (LRU-ish by insertion order)
//  - localStorage: survives restarts, only for payloads small enough to be
//    sensible (playlists can be large, so big entries stay memory-only)
//
// `cached()` also coalesces concurrent loads, so two views asking for the same
// playlist at once produce a single request.

interface MemoryEntry {
  value: unknown;
  expires: number;
}

const MEMORY_MAX = 48;
const PERSIST_MAX = 12;
const PERSIST_PREFIX = 'cherry.cache.';
/**
 * Per-entry persist budget. Playlist *contents* are the whole point of
 * surviving a restart (re-opening a 1000-track playlist should be instant and
 * offline-ish), and a full track list comfortably exceeds the old 250 KB cap —
 * which is why playlist contents never survived shutdown. The overall budget
 * is enforced separately below.
 */
const PERSIST_MAX_BYTES = 3_000_000;
/** Overall localStorage budget. `~5 MB` is the usual browser allowance; stay
 *  well under it so a write never throws and wipes everything. */
const PERSIST_BUDGET_BYTES = 4_000_000;
/**
 * Keys whose entries are worth keeping when the budget is tight. These are
 * persisted last-write-wins and are evicted *last*, so the thing the user
 * actually asked to remember (a playlist's tracks) is not pushed out by a
 * transient search result.
 */
const PERSIST_PRIORITY = /^(collection:|library:|channels:)/;

const memory = new Map<string, MemoryEntry>();
const inflight = new Map<string, Promise<unknown>>();

function now(): number {
  return Date.now();
}

function persistKey(key: string): string {
  return PERSIST_PREFIX + key;
}

function localStore(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readPersisted<T>(key: string): T | null {
  const store = localStore();
  if (!store) return null;
  try {
    const raw = store.getItem(persistKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { e: number; v: T };
    if (typeof parsed?.e !== 'number' || parsed.e <= now()) {
      store.removeItem(persistKey(key));
      return null;
    }
    memory.set(key, { value: parsed.v, expires: parsed.e });
    return parsed.v;
  } catch {
    return null;
  }
}

function pruneMemory(): void {
  while (memory.size > MEMORY_MAX) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

function prunePersisted(): void {
  const store = localStore();
  if (!store) return;
  try {
    const keys: { key: string; size: number; priority: boolean }[] = [];
    let total = 0;
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (!k || !k.startsWith(PERSIST_PREFIX)) continue;
      const value = store.getItem(k) ?? '';
      const size = k.length + value.length;
      total += size;
      keys.push({ key: k, size, priority: PERSIST_PRIORITY.test(k.slice(PERSIST_PREFIX.length)) });
    }
    // Drop non-priority entries first (oldest first, in insertion order), then
    // fall back to priority entries only if we are still over budget.
    const droppable = keys.filter((entry) => !entry.priority);
    const keepable = keys.filter((entry) => entry.priority);
    for (const entry of droppable) {
      if (keys.length <= PERSIST_MAX && total <= PERSIST_BUDGET_BYTES) break;
      store.removeItem(entry.key);
      total -= entry.size;
      keys.splice(keys.indexOf(entry), 1);
    }
    for (const entry of keepable) {
      if (total <= PERSIST_BUDGET_BYTES) break;
      store.removeItem(entry.key);
      total -= entry.size;
    }
  } catch {
    /* ignore */
  }
}

export function cacheGet<T>(key: string): T | null {
  const hit = memory.get(key);
  if (hit) {
    if (hit.expires > now()) return hit.value as T;
    memory.delete(key);
  }
  return readPersisted<T>(key);
}

export interface CacheSetOptions<T = unknown> {
  /** Allow writing to localStorage (default true). */
  persist?: boolean;
  /** Skip caching when this returns false (e.g. an empty/failed result, which
   *  must not be reused — that is how a transient failure turned into a
   *  "signed in but no profile" state). */
  shouldCache?: (value: T) => boolean;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number, options: CacheSetOptions<T> = {}): void {
  const expires = now() + ttlMs;
  memory.set(key, { value, expires });
  pruneMemory();

  if (options.persist === false) return;
  const store = localStore();
  if (!store) return;
  try {
    const payload = JSON.stringify({ e: expires, v: value });
    if (payload.length > PERSIST_MAX_BYTES) return;
    store.setItem(persistKey(key), payload);
    prunePersisted();
  } catch {
    /* quota or serialization failure: memory cache still applies */
  }
}

/** Return the cached value, or load it once (concurrent callers share). */
export function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>, options?: CacheSetOptions<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== null) return Promise.resolve(hit);

  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = loader()
    .then((value) => {
      if (inflight.get(key) === promise && (!options?.shouldCache || options.shouldCache(value))) {
        cacheSet(key, value, ttlMs, options);
      }
      return value;
    })
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

/** Drop cached entries, optionally only those under a prefix. */
export function cacheClear(prefix = ''): void {
  // Detach old loaders too: a refresh must issue a new request, and an old
  // response must not repopulate entries that were explicitly cleared.
  for (const key of [...inflight.keys()]) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
  for (const key of [...memory.keys()]) {
    if (key.startsWith(prefix)) memory.delete(key);
  }
  const store = localStore();
  if (!store) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(PERSIST_PREFIX) && k.slice(PERSIST_PREFIX.length).startsWith(prefix)) {
        doomed.push(k);
      }
    }
    for (const k of doomed) store.removeItem(k);
  } catch {
    /* ignore */
  }
}
