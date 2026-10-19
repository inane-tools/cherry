import { writable } from 'svelte/store';

export interface PageVisit { token: object; restore: boolean }
export interface PagePosition { top: number; horizontal: Record<string, number> }
export const pageVisitStore = writable<PageVisit>({ token: {}, restore: false });
export const pageVisitCacheEpoch = writable(0);
let positions = new WeakMap<object, PagePosition>();
let views = new WeakMap<object, unknown>();

// History owns the visit tokens. Dropped history entries release their snapshots
// without keeping pages or DOM nodes alive in a separate cache.
export const readPagePosition = (token: object) => positions.get(token);
export const savePagePosition = (token: object, position: PagePosition) => positions.set(token, position);
export const readPageView = <T>(token: object) => views.get(token) as T | undefined;
export const savePageView = <T>(token: object, state: T) => views.set(token, state);
export function clearPageVisitCache(): void {
  positions = new WeakMap(); views = new WeakMap();
  pageVisitCacheEpoch.update(epoch => epoch + 1);
}
