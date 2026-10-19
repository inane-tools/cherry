import { beforeEach, expect, it, vi } from 'vitest';
const execute = vi.hoisted(() => vi.fn());
vi.mock('youtubei.js', () => ({ Platform: { shim: {} }, Innertube: { create: async () => ({ actions: { execute } }) } }));
vi.mock('./evaluator', () => ({ installEvaluator: () => {} }));
import { getPlaylistMeta, resetInnertubeClient, setActiveChannel } from './InnertubeClient';
import { scanPageHeader } from './rawHome';
import { cacheClear } from '$lib/infra/storage/cache';
const header = { title: { runs: [{ text: 'My playlist' }] } };
beforeEach(() => { cacheClear(); resetInnertubeClient(); setActiveChannel('brand'); execute.mockReset(); });
it('recognizes the editable wrapper and keeps its header metadata', () => {
  expect(scanPageHeader({ header: { musicEditablePlaylistDetailHeaderRenderer: { header: { musicResponsiveHeaderRenderer: header } } } })).toMatchObject({ title: 'My playlist', canEdit: true });
  expect(scanPageHeader({ header: { musicResponsiveHeaderRenderer: header } })?.canEdit).toBeUndefined();
});
it.each(['straplineTextOne', 'subtitle'])('reads a playlist creator from the channel link in %s', async field => {
  const creator = { runs: [
    { text: 'Playlist · ' },
    { text: 'The curator', navigationEndpoint: { browseEndpoint: { browseId: 'UCcreator' } } },
    { text: ' · 2026' },
  ] };
  execute.mockResolvedValueOnce({ data: { header: { musicResponsiveHeaderRenderer: { ...header, [field]: creator } } } });
  expect(await getPlaylistMeta('VLcreator')).toMatchObject({ title: 'My playlist', author: 'The curator' });
});
it('keeps creator metadata separate from playlist type and track counts', () => {
  expect(scanPageHeader({ header: { musicDetailHeaderRenderer: { ...header, subtitle: { runs: [{ text: 'Playlist · 12 songs' }] } } } })?.author).toBeUndefined();
  expect(scanPageHeader({ header: { musicResponsiveHeaderRenderer: { ...header, straplineTextOne: { simpleText: 'The curator' } } } })?.author).toBe('The curator');
});
it('loads and caches the creator from the current avatar-stack playlist header', async () => {
  // Shape verified against a live YouTube Music browse response. The creator
  // has moved out of the strapline/subtitle and uses attributed text.
  execute.mockResolvedValueOnce({ data: { contents: { twoColumnBrowseResultsRenderer: {
    tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ musicResponsiveHeaderRenderer: {
      ...header,
      subtitle: { runs: [{ text: 'Playlist' }, { text: ' • ' }, { text: '2026' }] },
      facepile: { avatarStackViewModel: {
        avatars: [{ avatarViewModel: { image: { sources: [{ url: 'https://image.test/avatar' }] } } }],
        text: { content: 'The curator' },
      } },
    } }] } } } }],
  } } } });
  expect(await getPlaylistMeta('VLfacepile')).toMatchObject({ title: 'My playlist', author: 'The curator' });
  expect(await getPlaylistMeta('VLfacepile')).toMatchObject({ author: 'The curator' });
  expect(execute).toHaveBeenCalledTimes(1);
});
it('returns permission evidence and isolates cached metadata by Google account slot', async () => {
  execute.mockResolvedValueOnce({ data: { header: { musicEditablePlaylistDetailHeaderRenderer: { header: { musicResponsiveHeaderRenderer: header } } } } })
    .mockResolvedValueOnce({ data: { header: { musicResponsiveHeaderRenderer: header } } });
  const session = { kind: 'cookie' as const, cookie: 'SID=synthetic', savedAt: 0 };
  expect(await getPlaylistMeta('VLPL123', session)).toMatchObject({ canEdit: true });
  expect((await getPlaylistMeta('VLPL123', { ...session, accountIndex: 1 }))?.canEdit).toBeUndefined();
  expect(await getPlaylistMeta('VLPL123', session)).toMatchObject({ canEdit: true });
  expect(execute).toHaveBeenCalledTimes(2);
});
