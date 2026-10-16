import { writable } from 'svelte/store';
import type { SearchResults } from '$lib/core/models';

export const searchQuery = writable('');
export const searchRequest = writable({ query: '', id: 0 });
export const searchResultsStore = writable<SearchResults | null>(null);

/** Search is a temporary overlay, not history to replay on the next open. */
export function resetSearchSession(): void {
  searchQuery.set('');
  searchResultsStore.set(null);
  searchRequest.set({ query: '', id: 0 });
}
