import { beforeEach, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
const mocks = vi.hoisted(() => ({ getTrack: vi.fn(), getPlaylistMeta: vi.fn(), play: vi.fn(), open: vi.fn() }));
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({ getTrack: mocks.getTrack, getPlaylistMeta: mocks.getPlaylistMeta }));
vi.mock('./player', () => ({ playTracks: mocks.play }));
vi.mock('./playlists', () => ({ openPlaylist: mocks.open }));
vi.mock('./auth', () => ({ authStore: writable({ cookie: 'session' }) }));
import { parseYouTubeLink, resolveParsedLink } from './openLink';
beforeEach(() => vi.clearAllMocks());

it('resolves a song preview without playing it or opening a page', async () => {
  const track = { videoId: 'song', title: 'Song title', artists: [{ name: 'Artist' }], thumbnails: [{ url: 'https://image.test/art.jpg' }] };
  mocks.getTrack.mockResolvedValue(track);
  const results = await resolveParsedLink(parseYouTubeLink('https://music.youtube.com/watch?v=song'));
  expect(results.songs).toEqual([track]);
  expect(mocks.play).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
});
it('resolves playlist metadata into a result without navigating', async () => {
  mocks.getPlaylistMeta.mockResolvedValue({ title: 'My playlist', thumbnails: [{ url: 'https://image.test/art.jpg' }] });
  const results = await resolveParsedLink(parseYouTubeLink('https://www.youtube.com/playlist?list=PLtest'));
  expect(results.playlists[0]).toMatchObject({ browseId: 'VLPLtest', title: 'My playlist' });
  expect(mocks.getPlaylistMeta).toHaveBeenCalledWith('VLPLtest', { cookie: 'session' });
  expect(mocks.open).not.toHaveBeenCalled();
});
it('keeps a clickable fallback result when song metadata cannot be retrieved', async () => {
  mocks.getTrack.mockResolvedValue(null);
  expect((await resolveParsedLink({ kind: 'track', videoId: 'song' })).songs[0]).toMatchObject({ videoId: 'song', title: 'YouTube song' });
  expect(mocks.play).not.toHaveBeenCalled();
});
it('recognizes Shorts, embedded and live video links', () => {
  for (const path of ['shorts', 'embed', 'live']) {
    expect(parseYouTubeLink(`https://youtube.com/${path}/song`)).toEqual({ kind: 'track', videoId: 'song' });
  }
});
