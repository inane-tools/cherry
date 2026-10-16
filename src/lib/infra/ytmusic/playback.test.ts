import { beforeEach, expect, it, vi } from 'vitest';
const execute = vi.hoisted(() => vi.fn());
vi.mock('youtubei.js', () => ({ Platform: { shim: {} }, Innertube: { create: async () => ({ actions: { execute } }) } }));
vi.mock('./evaluator', () => ({ installEvaluator: () => {} }));
import { getTrackLyrics, getRadioPage, resetInnertubeClient } from './InnertubeClient';
beforeEach(() => { resetInnertubeClient(); execute.mockReset(); });
it('requests timestamped lyrics and falls back to the plain web endpoint', async () => {
  execute.mockResolvedValueOnce({ data: { navigationEndpoint: { browseEndpoint: { browseId: 'MPLYlyrics' } } } })
    .mockRejectedValueOnce(new Error('Mobile lyrics unavailable'))
    .mockResolvedValueOnce({ data: { musicDescriptionShelfRenderer: { description: { simpleText: 'Plain lyrics' } } } });
  expect(await getTrackLyrics('song')).toMatchObject({ synced: false, lines: [{ text: 'Plain lyrics' }] });
  expect(execute).toHaveBeenNthCalledWith(2, '/browse', { browseId: 'MPLYlyrics', client: 'YTMUSIC_ANDROID' });
  expect(execute).toHaveBeenNthCalledWith(3, '/browse', { browseId: 'MPLYlyrics', client: 'YTMUSIC' });
});
it('returns missing lyrics without requesting an unrelated tab', async () => {
  execute.mockResolvedValueOnce({ data: { tabs: [] } });
  expect(await getTrackLyrics('song')).toBeNull(); expect(execute).toHaveBeenCalledOnce();
});
it('follows the server automix endpoint without guessing radio playlist ids', async () => {
  execute.mockResolvedValueOnce({ data: { automixPlaylistVideoRenderer: { navigationEndpoint: { watchPlaylistEndpoint: { playlistId: 'RDactual', params: 'server' } } } } })
    .mockResolvedValueOnce({ data: { playlistPanelRenderer: { playlistId: 'RDactual', contents: [{ playlistPanelVideoRenderer: { videoId: 'song', title: { simpleText: 'Song' } } }] } } });
  const page = await getRadioPage({ videoId: 'seed' });
  expect(page.tracks[0].videoId).toBe('song');
  expect(page.endpoint).toEqual({ playlistId: 'RDactual', params: 'server' });
  expect(execute).toHaveBeenLastCalledWith('/next', expect.objectContaining({ videoId: 'seed', playlistId: 'RDactual', params: 'server' }));
});
