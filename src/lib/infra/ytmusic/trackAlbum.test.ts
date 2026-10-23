import { beforeEach, expect, it, vi } from 'vitest';
const execute = vi.hoisted(() => vi.fn());
vi.mock('youtubei.js', () => ({ Platform: { shim: {} }, Innertube: { create: async () => ({ actions: { execute } }) } }));
vi.mock('./evaluator', () => ({ installEvaluator: () => {} }));
vi.mock('$lib/infra/storage/cache', () => ({ cached: (_key: string, _ttl: number, load: () => unknown) => load(), cacheGet: vi.fn(), cacheSet: vi.fn() }));
import { getTrackAlbum, resetInnertubeClient } from './InnertubeClient';

beforeEach(() => { resetInnertubeClient(); execute.mockReset(); });

const row = (videoId: string, albumId: string) => ({ playlistPanelVideoRenderer: {
  videoId, title: { simpleText: 'Song' }, longBylineText: { runs: [
    { text: 'Composer' }, { text: ' • ' },
    { text: 'Soundtrack', navigationEndpoint: { browseEndpoint: { browseId: albumId } } },
  ] },
} });

it('resolves only the requested song album, including wrapped queue rows', async () => {
  execute.mockResolvedValue({ data: { contents: [row('related-song', 'MPREwrong'),
    { playlistPanelVideoWrapperRenderer: { primaryRenderer: row('song', 'MPREcorrect') } },
  ] } });
  expect(await getTrackAlbum('song')).toEqual({ name: 'Soundtrack', browseId: 'MPREcorrect' });
  expect(execute).toHaveBeenCalledWith('next', { videoId: 'song', client: 'YTMUSIC', isAudioOnly: true });
});

it('does not borrow another song album when the requested song is absent', async () => {
  execute.mockResolvedValue({ data: { contents: [row('related-song', 'MPREwrong')] } });
  expect(await getTrackAlbum('song')).toBeUndefined();
});
