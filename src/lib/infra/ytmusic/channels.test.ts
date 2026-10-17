import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), getInfo: vi.fn(), execute: vi.fn() }));
vi.mock('youtubei.js', () => ({ Platform: { shim: {} }, Innertube: { create: mocks.create } }));
vi.mock('./evaluator', () => ({ installEvaluator: () => {} }));
import { getChannels, getInnertube, resetInnertubeClient, setActiveChannel } from './InnertubeClient';
import { cacheClear } from '$lib/infra/storage/cache';
beforeEach(() => {
  resetInnertubeClient(); cacheClear(); vi.clearAllMocks(); setActiveChannel('');
  mocks.getInfo.mockResolvedValue([]);
  mocks.create.mockImplementation(async options => ({ options, account: { getInfo: mocks.getInfo }, actions: { execute: mocks.execute } }));
});
it('creates separate clients for the selected Google account and brand identity', async () => {
  const session = { kind: 'cookie' as const, cookie: 'SID=test; __Secure-3PAPISID=signing', accountIndex: 2, savedAt: 0 };
  await getInnertube(session, { channel: 'brand-page' });
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ enable_session_cache: false, account_index: 2, on_behalf_of_user: 'brand-page', cookie: 'SAPISID=signing; SID=test; __Secure-3PAPISID=signing' }));
  await getInnertube({ ...session, accountIndex: 1 }, { channel: 'brand-page' });
  expect(mocks.create).toHaveBeenCalledTimes(2);
});
it('retains channel identities from switch tokens even when has_channel is missing', async () => {
  mocks.getInfo.mockResolvedValue([
    { account_name: { text: 'Brand' }, endpoint: { payload: { supportedTokens: [{ pageIdToken: { pageId: 'brand-page' } }] } }, is_selected: true },
    { account_name: { text: 'Personal' }, has_channel: true },
    { account_name: { text: 'Disabled' }, has_channel: true, is_disabled: true },
  ]);
  const channels = await getChannels({ kind: 'cookie', cookie: 'SID=test', accountIndex: 1, savedAt: 0 });
  expect(channels).toHaveLength(2);
  expect(channels[0]).toMatchObject({ name: 'Brand', pageId: 'brand-page', isChannel: true, isSelected: true });
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ account_index: 1 }));
  expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('on_behalf_of_user');
});
