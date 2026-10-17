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
it('returns permission evidence and isolates cached metadata by Google account slot', async () => {
  execute.mockResolvedValueOnce({ data: { header: { musicEditablePlaylistDetailHeaderRenderer: { header: { musicResponsiveHeaderRenderer: header } } } } })
    .mockResolvedValueOnce({ data: { header: { musicResponsiveHeaderRenderer: header } } });
  const session = { kind: 'cookie' as const, cookie: 'SID=synthetic', savedAt: 0 };
  expect(await getPlaylistMeta('VLPL123', session)).toMatchObject({ canEdit: true });
  expect((await getPlaylistMeta('VLPL123', { ...session, accountIndex: 1 }))?.canEdit).toBeUndefined();
  expect(await getPlaylistMeta('VLPL123', session)).toMatchObject({ canEdit: true });
  expect(execute).toHaveBeenCalledTimes(2);
});
