import { expect, it } from 'vitest';
import { onlySearchFilter, parseSearchFilter, withSearchFilter } from './searchFilter';

it.each(['artists', 'songs', 'albums', 'playlists'] as const)('extracts the standalone @%s filter wherever it is typed', filter => {
  expect(parseSearchFilter(`@${filter.toUpperCase()} some music`)).toEqual({ text: 'some music', filter });
  expect(parseSearchFilter(`some @${filter} music`)).toEqual({ text: 'some music', filter });
  expect(parseSearchFilter(`some music @${filter}`)).toEqual({ text: 'some music', filter });
  expect(parseSearchFilter(`@${filter}`)).toEqual({ text: '', filter });
});
it('leaves unknown tokens, addresses and URLs intact and makes the last explicit filter win', () => {
  for (const text of ['name@artists.com', 'https://youtube.com/@artists', '@unknown music', '@songs-extra']) {
    expect(parseSearchFilter(text)).toEqual({ text, filter: 'all' });
  }
  expect(parseSearchFilter('@songs @albums Artist')).toEqual({ text: 'Artist', filter: 'albums' });
});
it('switches/removes tokens while retaining the query, including an empty category query', () => {
  expect(withSearchFilter('Artist @albums', 'songs')).toBe('@songs Artist');
  expect(withSearchFilter('@songs Artist', 'all')).toBe('Artist');
  expect(withSearchFilter('', 'artists')).toBe('@artists ');
});
it('keeps only the selected result type without modifying the original response', () => {
  const results = { songs: [{ videoId: 'song', title: 'Song', artists: [], thumbnails: [] }], artists: [{ name: 'Artist' }], albums: [], playlists: [] };
  expect(onlySearchFilter(results, 'artists')).toEqual({ songs: [], artists: results.artists, albums: [], playlists: [] });
  expect(results.songs).toHaveLength(1);
  expect(onlySearchFilter(results, 'all')).toBe(results);
});
