import { beforeEach, expect, it, vi } from 'vitest';
const execute = vi.hoisted(() => vi.fn());
vi.mock('youtubei.js', () => ({ Platform: { shim: {} }, Innertube: { create: async () => ({ actions: { execute } }) } }));
vi.mock('./evaluator', () => ({ installEvaluator: () => {} }));
import { addPlaylistToLibrary, removePlaylistFromLibrary, deleteOwnedPlaylist, resetInnertubeClient, getHomePage } from './InnertubeClient';
const session = { kind: 'cookie' as const, cookie: 'test-session', savedAt: 0 };
beforeEach(() => { resetInnertubeClient(); execute.mockReset().mockResolvedValue({ success: true, status_code: 200, data: {} }); });

it('sends a structured playlist target for save and remove', async () => {
  await addPlaylistToLibrary('VLPL123', session);
  expect(execute).toHaveBeenLastCalledWith('like/like', { target: { playlistId: 'PL123' }, client: 'YTMUSIC' });
  await removePlaylistFromLibrary('VLPL123', session);
  expect(execute).toHaveBeenLastCalledWith('like/removelike', { target: { playlistId: 'PL123' }, client: 'YTMUSIC' });
});

it('deletes using playlistId without the browse prefix', async () => {
  await deleteOwnedPlaylist('VLPL123', session);
  expect(execute).toHaveBeenLastCalledWith('playlist/delete', { playlistId: 'PL123', client: 'YTMUSIC' });
});

it('rejects unsuccessful mutations so local state cannot report a false success', async () => {
  execute.mockResolvedValue({ success: false, status_code: 400, data: {} });
  await expect(addPlaylistToLibrary('PL123', session)).rejects.toThrow('could not save');
  await expect(removePlaylistFromLibrary('PL123', session)).rejects.toThrow('could not remove');
  await expect(deleteOwnedPlaylist('PL123', session)).rejects.toThrow('could not delete');
});

it('sends Home filter parameters on the first request and continuation tokens on later pages', async () => {
  await getHomePage(session, undefined, { browseId: 'FEmusic_home', label: 'Focus', params: 'focus-test' });
  expect(execute).toHaveBeenLastCalledWith('/browse', { browseId: 'FEmusic_home', params: 'focus-test', client: 'YTMUSIC' });
  await getHomePage(session, 'next-test', { browseId: 'FEmusic_home', label: 'Focus', params: 'focus-test' });
  expect(execute).toHaveBeenLastCalledWith('/browse', { continuation: 'next-test', client: 'YTMUSIC' });
});
