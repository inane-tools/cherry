import { expect, it } from 'vitest';
import { appendBrowseSections, browsePresentation } from './browseLayout';
import type { HomeSection } from '$lib/infra/ytmusic/rawHome';

const grid = (title: string, id: string): HomeSection => ({ title, presentation: 'grid', cards: [{ title: id, browseId: id, thumbnails: [] }], songs: [] });

it('respects upstream layouts and gives older collection data a grid/list fallback', () => {
  expect(browsePresentation({ ...grid('Collection', 'VLone'), presentation: 'carousel' })).toBe('carousel');
  expect(browsePresentation({ ...grid('Collection', 'VLone'), presentation: undefined })).toBe('grid');
  expect(browsePresentation({ title: 'Songs', cards: [], songs: [], layout: 'songs' })).toBe('list');
});

it('appends unlabelled continuation items into the original collection and preserves its grid', () => {
  const base = grid('From your library', 'VLone');
  const next = { ...grid('', 'VLtwo'), presentation: 'list' as const };
  const result = appendBrowseSections([base], [next]);
  expect(result).toHaveLength(1);
  expect(result[0].title).toBe('From your library');
  expect(result[0].presentation).toBe('grid');
  expect(result[0].cards.map(card => card.browseId)).toEqual(['VLone', 'VLtwo']);
  expect(appendBrowseSections(result, [next])[0].cards).toHaveLength(2);
  expect(appendBrowseSections([base], [grid('Other collection', 'VLother')])).toHaveLength(2);
});
