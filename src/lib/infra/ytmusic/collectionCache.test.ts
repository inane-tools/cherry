import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ playlist: vi.fn(), album: vi.fn(), execute: vi.fn() }));
vi.mock('youtubei.js', () => ({ Platform: { shim: {} }, Innertube: { create: async () => ({
  music: { getPlaylist: api.playlist, getAlbum: api.album }, actions: { execute: api.execute } }) } }));
vi.mock('./evaluator', () => ({ installEvaluator: () => {} }));
import { getAlbumPage, getCollectionTracks, streamCollectionTracks, resetInnertubeClient, setActiveChannel } from './InnertubeClient';
import { cacheClear, cacheGet } from '$lib/infra/storage/cache';
const session = { kind: 'cookie' as const, cookie: 'SID=fixture', savedAt: 0 };
const row = (id: string) => ({ id, title: id, artists: [], thumbnails: [] });
beforeEach(() => { cacheClear(); resetInnertubeClient(); setActiveChannel('brand'); api.playlist.mockReset(); api.album.mockReset(); api.execute.mockReset().mockResolvedValue({ data: {} }); });

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
  // The final page is flagged incomplete so callers do not treat it as the
  // playlist's real length.
  expect(progress).toHaveBeenLastCalledWith([expect.objectContaining({ videoId: 'first' })], true, false);
  expect(cacheGet('collection:brand:VLpartial')).toBeNull();
});
it('flags a fully read playlist as complete', async () => {
  api.playlist.mockResolvedValueOnce({ contents: [row('only')], has_continuation: false });
  const progress = vi.fn();
  await streamCollectionTracks('VLwhole', session, progress);
  expect(progress).toHaveBeenLastCalledWith([expect.objectContaining({ videoId: 'only' })], true, true);
});
it('does not cache a one-shot playlist read cut short by a failed continuation', async () => {
  // Queue actions read playlists this way; the playlist page shares the cache
  // key, so a cached short list made the page show it for the whole TTL.
  api.playlist.mockResolvedValueOnce({ contents: [row('first')], has_continuation: true,
    getContinuation: async () => { throw Error('offline'); } });
  const tracks = await getCollectionTracks('VLshort', session);
  expect(tracks).toHaveLength(1);
  expect(cacheGet('collection:brand:VLshort')).toBeNull();
  api.playlist.mockResolvedValueOnce({ contents: [row('first'), row('second')], has_continuation: false });
  expect(await getCollectionTracks('VLshort', session)).toHaveLength(2);
  expect(cacheGet('collection:brand:VLshort')).toHaveLength(2);
});
it('does not cache an album page whose track list was cut short', async () => {
  api.album.mockResolvedValueOnce({ contents: [row('one')], has_continuation: true,
    getContinuation: async () => { throw Error('offline'); } });
  expect((await getAlbumPage('MPREshort', session)).tracks).toHaveLength(1);
  api.album.mockResolvedValueOnce({ contents: [row('one'), row('two')], has_continuation: false });
  expect((await getAlbumPage('MPREshort', session)).tracks).toHaveLength(2);
  expect(api.album).toHaveBeenCalledTimes(2);
});
