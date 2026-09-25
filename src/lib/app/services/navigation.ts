import { derived, get, writable } from 'svelte/store';
import type { Album, AppView, ArtistRef, Playlist, SearchResults } from '$lib/core/models';

/**
 * A navigable page. Entity pages (playlist/artist/album) carry the entity that
 * was clicked, so Back restores exactly what the user was looking at rather
 * than whichever one happened to be opened last.
 */
export type Page =
  | { view: 'home' }
  | { view: 'explore' }
  | { view: 'search' }
  | { view: 'settings' }
  | { view: 'playlist'; entity: Playlist }
  | { view: 'artist'; entity: ArtistRef }
  | { view: 'album'; entity: Album };

export const pageStore = writable<Page>({ view: 'home' });
/** Kept for callers that only care *which* view is showing. */
export const viewStore = derived(pageStore, (page) => page.view);
export const canGoBack = writable(false);
export const canGoForward = writable(false);

const MAX_HISTORY = 64;
let history: Page[] = [];
let future: Page[] = [];

function syncHistoryFlags(): void {
  canGoBack.set(history.length > 0);
  canGoForward.set(future.length > 0);
}

/** Stable identity for a page, used to avoid pushing duplicates. */
function pageKey(page: Page): string {
  switch (page.view) {
    case 'playlist':
      return page.entity.browseId;
    case 'album':
      return page.entity.browseId;
    case 'artist':
      return page.entity.browseId ?? page.entity.name;
    default:
      return page.view;
  }
}

/** Navigate to a page, remembering where we came from. */
export function openPage(page: Page): void {
  const current = get(pageStore);
  // Re-opening the same page should not add history (otherwise Back appears
  // broken: one press just returns to the identical page).
  if (pageKey(page) === pageKey(current)) {
    pageStore.set(page);
    return;
  }
  history = [...history, current].slice(-MAX_HISTORY);
  // A fresh navigation invalidates the forward stack.
  future = [];
  pageStore.set(page);
  syncHistoryFlags();
}

/** Simple view navigation (home / explore / search / settings). */
export function go(view: Extract<AppView, 'home' | 'explore' | 'search' | 'settings'>): void {
  openPage({ view });
}

/** Go back one page (no-op at the start of the history). */
export function back(): void {
  const previous = history.pop();
  if (!previous) return;
  future = [get(pageStore), ...future].slice(0, MAX_HISTORY);
  pageStore.set(previous);
  syncHistoryFlags();
}

/** Go forward again after a Back (no-op with nothing to redo). */
export function forward(): void {
  const next = future.shift();
  if (!next) return;
  history = [...history, get(pageStore)].slice(-MAX_HISTORY);
  pageStore.set(next);
  syncHistoryFlags();
}

export function canGoBackNow(): boolean {
  return history.length > 0;
}

/**
 * Wire the mouse's Back/Forward (X1/X2) buttons to app navigation.
 *
 * Chromium reports the extra buttons as `button` 3 (back) and 4 (forward).
 * Returns a cleanup function.
 */
export function startMouseNavigation(): () => void {
  const onPress = (event: MouseEvent) => {
    if (event.button === 3) {
      event.preventDefault();
      back();
    } else if (event.button === 4) {
      event.preventDefault();
      forward();
    }
  };
  window.addEventListener('mouseup', onPress);
  return () => window.removeEventListener('mouseup', onPress);
}

// ── Search ──────────────────────────────────────────────────────
export const searchQuery = writable<string>('');

/** Bumped on every explicit search request. The Search view listens to this
 *  instead of the query value, so repeating the *same* query still runs a
 *  fresh search (previously a no-op — the visible "unreliable search" bug). */
export const searchRequest = writable<{ query: string; id: number }>({ query: '', id: 0 });

/** Last search results, kept outside the view so Back restores them. */
export const searchResultsStore = writable<SearchResults | null>(null);

let requestId = 0;

/** Commit a search from anywhere (top bar, shortcut) and open the view. */
export function requestSearch(query: string): void {
  const q = query.trim();
  if (!q) return;
  searchQuery.set(q);
  searchRequest.set({ query: q, id: ++requestId });
  openPage({ view: 'search' });
}
