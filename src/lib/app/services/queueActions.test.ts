import { beforeEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { AuthSession, Track } from '$lib/core/models';
const mocks = vi.hoisted(() => ({ tracks: vi.fn(), album: vi.fn(), add: vi.fn(), notify: vi.fn(), gate: vi.fn(), channel: 'one' }));
vi.mock('./auth', async () => ({ authStore: (await import('svelte/store')).writable<AuthSession | null>(null) }));
vi.mock('./account', () => ({ initChannel: vi.fn(async () => {}) }));
vi.mock('./player', () => ({ addToQueue: mocks.add }));
vi.mock('./contextMenu', () => ({ notify: mocks.notify }));
vi.mock('./gate', () => ({ announceSignInRequired: mocks.gate }));
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({ getCollectionTracks: mocks.tracks, getAlbumPage: mocks.album, getActiveChannel: () => mocks.channel }));
import { authStore } from './auth';
import { queueCollection } from './queueActions';
const song = (videoId: string): Track => ({ videoId, title: videoId, artists: [], thumbnails: [] });
const playlist = { browseId: 'VLplaylist', title: 'Playlist', thumbnails: [] };
beforeEach(() => {
  vi.clearAllMocks(); mocks.channel = 'one'; mocks.add.mockImplementation(tracks => tracks.length);
  authStore.set({ kind: 'cookie', cookie: 'SID=fixture', savedAt: 0 });
});

it('adds the full playlist in order and reports success', async () => {
  const tracks = [song('a'), song('b')]; mocks.tracks.mockResolvedValueOnce(tracks);
  await queueCollection(playlist);
  expect(mocks.add).toHaveBeenCalledExactlyOnceWith(tracks);
  expect(mocks.notify).toHaveBeenCalledWith('Added 2 songs to queue');
});

it('preserves album artists on tracks that omit them', async () => {
  mocks.album.mockResolvedValueOnce({ tracks: [song('a')], artists: [{ name: 'Album artist' }] });
  await queueCollection({ ...playlist, browseId: 'MPREalbum', artists: [] });
  expect(mocks.add).toHaveBeenCalledWith([{ ...song('a'), artists: [{ name: 'Album artist' }] }]);
});

it.each(['signout', 'account', 'channel'])('discards late results after %s', async change => {
  let finish!: (tracks: Track[]) => void;
  mocks.tracks.mockReturnValueOnce(new Promise<Track[]>(resolve => { finish = resolve; }));
  const request = queueCollection(playlist);
  await vi.waitFor(() => expect(mocks.tracks).toHaveBeenCalled());
  if (change === 'channel') mocks.channel = 'two';
  else authStore.set(change === 'signout' ? null : { ...get(authStore)!, cookie: 'SID=other' });
  finish([song('late')]); await request;
  expect(mocks.add).not.toHaveBeenCalled();
  expect(mocks.notify).not.toHaveBeenCalled();
});

it('reports empty collections and failures without changing the queue', async () => {
  mocks.tracks.mockResolvedValueOnce([]);
  await queueCollection(playlist);
  expect(mocks.notify).toHaveBeenCalledWith('No playable songs found.');
  mocks.tracks.mockRejectedValueOnce(new Error('Offline'));
  await queueCollection(playlist);
  expect(mocks.notify).toHaveBeenCalledWith('Could not add to queue: Offline');
  expect(mocks.add).not.toHaveBeenCalled();
});

it('requires a session before fetching collection tracks', async () => {
  authStore.set(null); await queueCollection(playlist);
  expect(mocks.gate).toHaveBeenCalledOnce();
  expect(mocks.tracks).not.toHaveBeenCalled();
});
