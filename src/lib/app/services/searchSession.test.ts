import { expect, it } from 'vitest';
import { get } from 'svelte/store';
import { requestSearch } from './navigation';
import { openSearch, closeSearch, searchOpen } from './overlays';
import { searchQuery, searchRequest, searchResultsStore } from './searchSession';

it('reopens search empty and does not replay a previously pasted link', () => {
  requestSearch('https://music.youtube.com/watch?v=old');
  searchResultsStore.set({ songs: [{ videoId: 'old', title: 'Old', artists: [], thumbnails: [] }], albums: [], artists: [], playlists: [] });
  expect(get(searchOpen)).toBe(true);
  closeSearch(); openSearch();
  expect(get(searchQuery)).toBe('');
  expect(get(searchResultsStore)).toBeNull();
  expect(get(searchRequest)).toEqual({ query: '', id: 0 });
  closeSearch();
});
it('allows a fresh explicit search after closing while preserving repeat-query requests', () => {
  requestSearch('artist');
  const first = get(searchRequest).id;
  closeSearch();
  requestSearch('artist');
  expect(get(searchQuery)).toBe('artist');
  expect(get(searchRequest).id).toBeGreaterThan(first);
  expect(get(searchOpen)).toBe(true);
  closeSearch();
});
