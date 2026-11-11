import { beforeEach, expect, it, vi } from 'vitest';
const execute = vi.hoisted(() => vi.fn());
const addVideos = vi.hoisted(() => vi.fn());
vi.mock('youtubei.js', () => ({ Platform: { shim: {} }, Innertube: { create: async () => ({ actions: { execute }, playlist: { addVideos } }) } }));
vi.mock('./evaluator', () => ({ installEvaluator: () => {} }));
import { addPlaylistToLibrary, removePlaylistFromLibrary, addTracksToPlaylist, removeTrackFromPlaylist, deleteOwnedPlaylist, resetInnertubeClient, getHomePage, renamePlaylist, setPlaylistDescription, setPlaylistCustomThumbnail } from './InnertubeClient';
const session = { kind: 'cookie' as const, cookie: 'test-session', savedAt: 0 };
beforeEach(() => { resetInnertubeClient(); addVideos.mockReset().mockResolvedValue({ success: true }); execute.mockReset().mockResolvedValue({ success: true, status_code: 200, data: {} }); });

it('distinguishes a successful upload from a denied cover attach', async () => {
  execute.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 403'), { info: JSON.stringify({ error: { message: 'The caller does not have permission' } }) }));
  await expect(setPlaylistCustomThumbnail('VLPL123', 'uploaded-blob', session)).rejects.toThrow('The image uploaded, but YouTube denied applying it');
});

it('renames with a real playlistId and supports clearing the description', async () => {
  await renamePlaylist('VLPL123', 'Renamed', session);
  expect(execute).toHaveBeenLastCalledWith('browse/edit_playlist', {
    playlistId: 'PL123', actions: [{ action: 'ACTION_SET_PLAYLIST_NAME', playlistName: 'Renamed' }], client: 'YTMUSIC',
  });
  await setPlaylistDescription('VLPL123', '', session);
  expect(execute).toHaveBeenLastCalledWith('browse/edit_playlist', {
    playlistId: 'PL123', actions: [{ action: 'ACTION_SET_PLAYLIST_DESCRIPTION', playlistDescription: '' }], client: 'YTMUSIC',
  });
});
it('reports rejected playlist edits rather than announcing a successful rename', async () => {
  execute.mockResolvedValueOnce({ success: true, data: { status: 'STATUS_FAILED' } });
  await expect(renamePlaylist('VLPL123', 'Renamed', session)).rejects.toThrow(/rename/);
});

it.each(['VLLM', 'LM', 'VLLL', 'LL'])('adds to %s through song likes, once per distinct video', async playlistId => {
  await addTracksToPlaylist(playlistId, ['song-a', 'song-b', 'song-a'], session);
  expect(execute.mock.calls).toEqual([
    ['like/like', { target: { videoId: 'song-a' }, client: 'YTMUSIC' }],
    ['like/like', { target: { videoId: 'song-b' }, client: 'YTMUSIC' }],
  ]);
  expect(addVideos).not.toHaveBeenCalled();
});

it('keeps normal playlist adds and intentional duplicates intact', async () => {
  await addTracksToPlaylist('VLPL123', ['song', 'song'], session);
  expect(addVideos).toHaveBeenCalledWith('PL123', ['song', 'song']);
  expect(execute).not.toHaveBeenCalled();
});

it('reports rejected likes rather than treating them as successful playlist edits', async () => {
  execute.mockResolvedValueOnce({ success: false, status_code: 400, data: {} });
  await expect(addTracksToPlaylist('VLLM', ['song'], session)).rejects.toThrow('could not like');
});

it('removes liked songs by clearing their rating without looking up playlist entries', async () => {
  await removeTrackFromPlaylist('VLLM', 'song', session);
  expect(execute).toHaveBeenCalledExactlyOnceWith('like/removelike', { target: { videoId: 'song' }, client: 'YTMUSIC' });
});

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

it('removes exactly one server-issued playlist entry without browsing or matching every duplicate', async () => {
  await expect(removeTrackFromPlaylist('VLPLtest', 'same', session, { playlistEntryId: 'entry-b' })).resolves.toBe('entry-b');
  expect(execute).toHaveBeenCalledExactlyOnceWith('browse/edit_playlist', {
    playlistId: 'PLtest', actions: [{ action: 'ACTION_REMOVE_VIDEO', setVideoId: 'entry-b' }], client: 'YTMUSIC',
  });
});

it('resolves a duplicate occurrence across continuations when old cached tracks lack entry IDs', async () => {
  const row = (id: string) => ({ musicResponsiveListItemRenderer: { playlistItemData: { videoId: 'same', playlistSetVideoId: id } } });
  execute.mockResolvedValueOnce({ data: { contents: { musicPlaylistShelfRenderer: {
    contents: [row('entry-a')], continuations: [{ nextContinuationData: { continuation: 'next-page' } }],
  } } } }).mockResolvedValueOnce({ data: { continuationContents: { musicPlaylistShelfContinuation: { contents: [row('entry-b')] } } } });
  // The resolved id is returned so the caller can record the removal.
  await expect(removeTrackFromPlaylist('VLPLtest', 'same', session, { occurrence: 1 })).resolves.toBe('entry-b');
  expect(execute).toHaveBeenNthCalledWith(2, '/browse', { continuation: 'next-page', client: 'YTMUSIC' });
  expect(execute).toHaveBeenLastCalledWith('browse/edit_playlist', {
    playlistId: 'PLtest', actions: [{ action: 'ACTION_REMOVE_VIDEO', setVideoId: 'entry-b' }], client: 'YTMUSIC',
  });
});

it('never sends a removal if the requested occurrence cannot be resolved', async () => {
  execute.mockResolvedValue({ data: { contents: { musicPlaylistShelfRenderer: { contents: [] } } } });
  await expect(removeTrackFromPlaylist('VLPLtest', 'missing', session)).rejects.toThrow('could not be found');
  expect(execute).toHaveBeenCalledTimes(1);
});

it('surfaces rejected song removals', async () => {
  execute.mockResolvedValue({ success: false, status_code: 403, data: {} });
  await expect(removeTrackFromPlaylist('VLPLtest', 'same', session, { playlistEntryId: 'entry-b' })).rejects.toThrow('could not remove');
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
