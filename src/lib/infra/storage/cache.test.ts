import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheClear, cacheGet, cacheSet, cached } from './cache';

beforeEach(() => {
  cacheClear();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('cache', () => {
  it('returns values until they expire', () => {
    vi.useFakeTimers();
    cacheSet('k', { a: 1 }, 1000);
    expect(cacheGet('k')).toEqual({ a: 1 });
    vi.advanceTimersByTime(1001);
    expect(cacheGet('k')).toBeNull();
  });

  it('survives a restart through localStorage', () => {
    cacheSet('collection:x', [1, 2, 3], 60_000);
    // Simulate a fresh process: memory gone, storage kept.
    const stored = localStorage.getItem('cherry.cache.collection:x');
    cacheClear();
    localStorage.setItem('cherry.cache.collection:x', stored!);
    expect(cacheGet('collection:x')).toEqual([1, 2, 3]);
  });

  it('can stay memory-only', () => {
    cacheSet('channels:x', ['c'], 60_000, { persist: false });
    expect(localStorage.getItem('cherry.cache.channels:x')).toBeNull();
    expect(cacheGet('channels:x')).toEqual(['c']);
  });

  it('coalesces concurrent loads', async () => {
    const loader = vi.fn(async () => 'value');
    const [a, b] = await Promise.all([cached('c', 1000, loader), cached('c', 1000, loader)]);
    expect(a).toBe('value');
    expect(b).toBe('value');
    expect(loader).toHaveBeenCalledTimes(1);
    expect(await cached('c', 1000, loader)).toBe('value');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('does not cache values rejected by shouldCache, nor failures', async () => {
    const empty = vi.fn(async () => [] as number[]);
    await cached('e', 1000, empty, { shouldCache: (v) => v.length > 0 });
    await cached('e', 1000, empty, { shouldCache: (v) => v.length > 0 });
    expect(empty).toHaveBeenCalledTimes(2);

    const failing = vi.fn(async () => {
      throw new Error('down');
    });
    await expect(cached('f', 1000, failing)).rejects.toThrow('down');
    await expect(cached('f', 1000, failing)).rejects.toThrow('down');
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('clears by prefix only', () => {
    cacheSet('meta:1', 'a', 60_000);
    cacheSet('collection:1', 'b', 60_000);
    cacheClear('meta:');
    expect(cacheGet('meta:1')).toBeNull();
    expect(cacheGet('collection:1')).toBe('b');
  });

  it('refetches after clearing and prevents an older loader from overwriting the new value', async () => {
    let finishOld!: (value: string) => void;
    const old = cached('library:1', 1000, () => new Promise<string>((resolve) => (finishOld = resolve)));
    cacheClear('library:');
    expect(await cached('library:1', 1000, async () => 'new')).toBe('new');
    finishOld('old');
    expect(await old).toBe('old');
    expect(cacheGet('library:1')).toBe('new');
  });

  it('does not let an old completion remove a newer pending loader', async () => {
    let finishOld!: (value: string) => void;
    let finishNew!: (value: string) => void;
    const old = cached('library:1', 1000, () => new Promise<string>((resolve) => (finishOld = resolve)));
    cacheClear();
    const fresh = cached('library:1', 1000, () => new Promise<string>((resolve) => (finishNew = resolve)));
    finishOld('old');
    await old;
    expect(cacheGet('library:1')).toBeNull();
    expect(cached('library:1', 1000, async () => 'unexpected')).toBe(fresh);
    finishNew('new');
    await fresh;
    expect(cacheGet('library:1')).toBe('new');
  });

  it('evicts non-priority entries first when over the entry limit', () => {
    cacheSet('collection:keep', 'p', 60_000);
    for (let i = 0; i < 20; i++) cacheSet(`search:${i}`, i, 60_000);
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('cherry.cache.'));
    expect(keys).toContain('cherry.cache.collection:keep');
    expect(keys.length).toBeLessThanOrEqual(13);
  });

  it('drops corrupt persisted entries', () => {
    localStorage.setItem('cherry.cache.bad', '{not json');
    expect(cacheGet('bad')).toBeNull();
    localStorage.setItem('cherry.cache.old', JSON.stringify({ e: 1, v: 'x' }));
    expect(cacheGet('old')).toBeNull();
    expect(localStorage.getItem('cherry.cache.old')).toBeNull();
  });
});
