import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ execute: vi.fn(), create: vi.fn() }));
vi.mock('youtubei.js', () => ({ Platform: { shim: {} }, Constants: { CLIENTS: { YTMUSIC: { VERSION: 'music-version' } } }, Innertube: { create: mocks.create } }));
vi.mock('./evaluator', () => ({ installEvaluator: () => {} }));
import { getLibraryPlaylists, getPlaylistImageContext, getAddablePlaylists, resetInnertubeClient, setActiveChannel } from './InnertubeClient';
import { cacheClear } from '$lib/infra/storage/cache';
const session = { kind: 'cookie' as const, cookie: 'SID=test', accountIndex: 2, savedAt: 0 };
const page = (id: string, next?: string) => ({ data: { continuationContents: { gridContinuation: {
  items: [{ musicTwoRowItemRenderer: { title: { simpleText: id }, navigationEndpoint: { browseEndpoint: { browseId: 'VLPL' + id } } } }],
  continuations: next ? [{ nextContinuationData: { continuation: next } }] : [],
} } } });
beforeEach(() => {
  cacheClear(); resetInnertubeClient(); setActiveChannel('brand');
  mocks.execute.mockReset(); mocks.create.mockReset().mockResolvedValue({ actions: { execute: mocks.execute } });
});
it('uses the pinned Music client version and the selected client visitor for image uploads', async () => {
  mocks.create.mockResolvedValueOnce({ session: { context: { client: { visitorData: 'brand-visitor' } } } });
  expect(await getPlaylistImageContext(session)).toEqual({ clientVersion: 'music-version', visitorData: 'brand-visitor' });
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ on_behalf_of_user: 'brand' }));
});
it('loads every library page beyond the old five-page limit for the selected brand', async () => {
  for (let i = 0; i < 7; i++) mocks.execute.mockResolvedValueOnce(page(String(i), i < 6 ? String(i + 1) : undefined));
  expect((await getLibraryPlaylists(session)).map(p => p.title)).toEqual(['0', '1', '2', '3', '4', '5', '6']);
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ account_index: 2, on_behalf_of_user: 'brand' }));
  expect(mocks.execute).toHaveBeenNthCalledWith(7, '/browse', { continuation: '6', client: 'YTMUSIC' });
});
it('does not cache an incomplete library after a continuation request fails', async () => {
  mocks.execute.mockResolvedValueOnce(page('first', 'next')).mockRejectedValueOnce(new Error('offline'));
  const progress = vi.fn();
  await expect(getLibraryPlaylists(session, progress)).rejects.toThrow(/offline/);
  expect(progress).toHaveBeenLastCalledWith([expect.objectContaining({ title: 'first' })]);
  mocks.execute.mockResolvedValueOnce(page('first', 'next')).mockResolvedValueOnce(page('last'));
  expect((await getLibraryPlaylists(session)).map(p => p.title)).toEqual(['first', 'last']);
});
it('merges web-only playlists and web continuations with Music without duplicating existing rows', async () => {
  const webPage = (id: string, next?: string) => ({ data: { richGridRenderer: { contents: [
    { richItemRenderer: { content: { lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST', contentId: 'PL' + id, metadata: { lockupMetadataViewModel: { title: { content: id } } } } } } },
    ...(next ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: next } } } }] : []),
  ] } } });
  mocks.execute.mockResolvedValueOnce(page('music')).mockResolvedValueOnce(webPage('empty', 'next-web')).mockResolvedValueOnce(webPage('music'));
  expect((await getLibraryPlaylists(session)).map(p => p.title)).toEqual(['music', 'empty']);
  expect(mocks.execute).toHaveBeenNthCalledWith(2, '/browse', { browseId: 'FEplaylist_aggregation', client: 'WEB' });
  expect(mocks.execute).toHaveBeenNthCalledWith(3, '/browse', { continuation: 'next-web', client: 'WEB' });
});
it('includes web-only editable playlists in edit menus under the same selected brand', async () => {
  const option = (playlistId: string) => ({ playlistAddToOptionRenderer: { playlistId, title: { simpleText: playlistId } } });
  mocks.execute.mockResolvedValueOnce({ data: { contents: [option('LM')] } }).mockResolvedValueOnce({ data: { contents: [option('PLempty')] } });
  expect((await getAddablePlaylists(session, ['song'])).map(p => p.browseId)).toEqual(['VLLM', 'VLPLempty']);
  expect(mocks.execute).toHaveBeenLastCalledWith('playlist/get_add_to_playlist', { videoIds: ['song'], excludeWatchLater: true, client: 'WEB' });
});
it('rejects repeated continuation tokens rather than silently truncating the library', async () => {
  mocks.execute.mockResolvedValue(page('first', 'repeated'));
  await expect(getLibraryPlaylists(session)).rejects.toThrow(/repeat/i);
  expect(mocks.execute).toHaveBeenCalledTimes(2);
});
it('identifies the failed page and includes only YouTube’s error message from its response', async () => {
  const error = Object.assign(new Error('HTTP 400'), { info: JSON.stringify({ error: { message: 'Invalid continuation' }, privateDebug: 'do-not-display' }) });
  mocks.execute.mockResolvedValueOnce(page('first', 'next')).mockRejectedValueOnce(error);
  await expect(getLibraryPlaylists(session)).rejects.toThrow('Loaded 1 playlists, but page 2 could not be loaded: HTTP 400 — Invalid continuation');
});
