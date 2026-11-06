import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ playlist: vi.fn() }));
vi.mock('youtubei.js', () => ({ Platform: { shim: {} }, Innertube: { create: async () => ({ music: { getPlaylist: api.playlist } }) } }));
vi.mock('./evaluator', () => ({ installEvaluator: () => {} }));
import { streamCollectionTracks, resetInnertubeClient, setActiveChannel } from './InnertubeClient';
import { cacheClear, cacheGet } from '$lib/infra/storage/cache';
const session = { kind: 'cookie' as const, cookie: 'SID=fixture', savedAt: 0 };
const row = (id: string) => ({ id, title: id, artists: [], thumbnails: [] });
beforeEach(() => { cacheClear(); resetInnertubeClient(); setActiveChannel('brand'); api.playlist.mockReset(); });

it('does not let a progressive request restore a cache invalidated by an edit', async () => {
  let finish!: (value: unknown) => void;
  api.playlist.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const loading = streamCollectionTracks('VLlist', session, vi.fn());
  await vi.waitFor(() => expect(api.playlist).toHaveBeenCalled());
  cacheClear('collection:brand:VLlist');
  finish({ contents: [row('old')], has_continuation: false });
  await loading;
  expect(cacheGet('collection:brand:VLlist')).toBeNull();
  api.playlist.mockResolvedValueOnce({ contents: [row('old'), row('added')], has_continuation: false });
  const fresh = await streamCollectionTracks('VLlist', session, vi.fn());
  expect(fresh.map(track => track.videoId)).toEqual(['old', 'added']);
  expect(api.playlist).toHaveBeenCalledTimes(2);
});
it('keeps partial tracks usable but never caches a failed continuation as the full playlist', async () => {
  api.playlist.mockResolvedValueOnce({ contents: [row('first')], has_continuation: true,
    getContinuation: async () => { throw Error('offline'); } });
  const progress = vi.fn();
  const tracks = await streamCollectionTracks('VLpartial', session, progress);
  expect(tracks).toHaveLength(1);
  expect(progress).toHaveBeenCalled();
  expect(cacheGet('collection:brand:VLpartial')).toBeNull();
});
