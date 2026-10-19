import { beforeEach, expect, it, vi } from 'vitest';
const search = vi.hoisted(() => vi.fn());
vi.mock('youtubei.js', () => ({ Platform: { shim: {} }, Innertube: { create: async () => ({ music: { search } }) } }));
vi.mock('./evaluator', () => ({ installEvaluator: () => {} }));
import { resetInnertubeClient, searchAll, setActiveChannel } from './InnertubeClient';
import { cacheClear } from '$lib/infra/storage/cache';

const row = (item_type: string, id: string) => ({ item_type, id, title: id });
const contents = [{ type: 'MusicShelf', title: 'Results', contents: [row('song', 'song'), row('artist', 'UCartist'), row('album', 'MPRalbum'), row('playlist', 'VLplaylist')] }];
beforeEach(() => { cacheClear(); resetInnertubeClient(); setActiveChannel('brand'); search.mockReset().mockResolvedValue({ contents }); });

it.each([['songs', 'song'], ['artists', 'artist'], ['albums', 'album'], ['playlists', 'playlist']] as const)('requests the upstream %s filter and excludes other result types', async (filter, type) => {
  const result = await searchAll('some music', null, filter);
  expect(search).toHaveBeenCalledExactlyOnceWith('some music', { type });
  expect(result[filter]).toHaveLength(1);
  for (const category of ['songs', 'artists', 'albums', 'playlists'] as const) if (category !== filter) expect(result[category]).toEqual([]);
});
it('continues only the requested category when a filtered page has more results', async () => {
  const getContinuation = vi.fn(async () => ({ contents: { type: 'MusicShelfContinuation', contents: [row('song', 'next-song')] } }));
  search.mockResolvedValueOnce({ contents, getContinuation });
  const result = await searchAll('some music', null, 'songs');
  expect(result.songs.map(song => song.videoId)).toEqual(['song', 'next-song']);
  expect(getContinuation).toHaveBeenCalledOnce();
});
it('isolates cached searches by category, signed-in account and channel', async () => {
  const session = { kind: 'cookie' as const, cookie: 'SID=synthetic', savedAt: 0 };
  await searchAll('same query', session, 'songs'); await searchAll('same query', session, 'songs');
  expect(search).toHaveBeenCalledTimes(1);
  await searchAll('same query', session, 'artists');
  await searchAll('same query', { ...session, accountIndex: 1 }, 'songs');
  setActiveChannel('other'); await searchAll('same query', session, 'songs');
  expect(search).toHaveBeenCalledTimes(4);
});
