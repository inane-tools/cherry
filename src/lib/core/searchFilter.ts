import type { SearchResults } from './models';

export type SearchFilter = 'all' | keyof SearchResults;
export const SEARCH_FILTERS: { value: SearchFilter; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'songs', label: 'Songs' },
  { value: 'artists', label: 'Artists' }, { value: 'albums', label: 'Albums' }, { value: 'playlists', label: 'Playlists' },
];
const tokens = () => /(^|\s)@(artists|songs|albums|playlists)(?=\s|$)/gi;

/** Standalone tokens only, so email addresses and URLs remain intact. */
export function parseSearchFilter(input: string): { text: string; filter: SearchFilter } {
  let filter: SearchFilter = 'all';
  const text = input.replace(tokens(), (_, space: string, category: string) => {
    filter = category.toLowerCase() as SearchFilter;
    return space;
  }).trim().replace(/\s{2,}/g, ' ');
  return { text, filter };
}

export function withSearchFilter(input: string, filter: SearchFilter): string {
  const { text } = parseSearchFilter(input);
  return filter === 'all' ? text : `@${filter}${text ? ` ${text}` : ' '}`;
}

export function onlySearchFilter(results: SearchResults, filter: SearchFilter): SearchResults {
  if (filter === 'all') return results;
  return { songs: [], artists: [], albums: [], playlists: [], [filter]: results[filter] };
}
