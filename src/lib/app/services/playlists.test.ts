import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { AuthSession, Playlist, Track } from '$lib/core/models';
import type { HomeSection } from '$lib/infra/ytmusic/rawHome';

vi.mock('./auth', async () => {
  const { writable } = await import('svelte/store');
  return { authStore: writable<AuthSession | null>(null) };
});
const editableMocks = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('./addablePlaylists', async () => ({ addablePlaylistsStore: (await import('svelte/store')).writable<Playlist[]>([]), addPlaylistLocally: editableMocks.add }));
vi.mock('./account', () => ({ initChannel: vi.fn(async () => null) }));
vi.mock('./player', () => ({ playTracks: vi.fn(), playTracksShuffled: vi.fn() }));
vi.mock('$lib/infra/storage/cache', () => ({ cacheClear: vi.fn() }));
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({
  getActiveChannel: vi.fn(() => 'channel'),
  getLibraryPlaylists: vi.fn(), getHomeSections: vi.fn(), getHomePage: vi.fn(),
  getPlaylistMeta: vi.fn(async () => null), streamCollectionTracks: vi.fn(),
}));

const { authStore } = await import('./auth');
const { initChannel } = await import('./account');
const api = await import('$lib/infra/ytmusic/InnertubeClient');
const service = await import('./playlists');
const { clearQueue, queueItems } = await import('./queue');
const { playTracks } = await import('./player');
const session: AuthSession = { kind: 'cookie', cookie: 'SID=account', savedAt: 0 };
const playlist = (title: string): Playlist => ({ title, browseId: title, thumbnails: [] });
const section = (title: string): HomeSection => ({ title, cards: [], songs: [] });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  clearQueue();
  authStore.set(null);
  authStore.set(session);
  vi.mocked(initChannel).mockResolvedValue(null);
  vi.mocked(api.getActiveChannel).mockReturnValue('channel');
  vi.mocked(api.getLibraryPlaylists).mockResolvedValue([playlist('new')]);
  vi.mocked(api.getHomeSections).mockResolvedValue([section('new')]);
  vi.mocked(api.getHomePage).mockImplementation(async () => ({ sections: await api.getHomeSections(), continuation: null }));
});

describe('account and channel loads', () => {
  it('loads extra Home sections, removes duplicates, and stops repeated continuation tokens', async () => {
    vi.mocked(api.getHomePage).mockResolvedValueOnce({ sections: [section('first')], continuation: 'next' }).mockResolvedValueOnce({ sections: [section('first'), section('second')], continuation: 'next' });
    await service.loadHome();
    await service.loadMoreHome();
    expect(get(service.homeSectionsStore).map((s) => s.title)).toEqual(['first', 'second']);
    expect(get(service.homeContinuationStore)).toBeNull();
  });

  it('ignores stale filter results when another Home filter is selected', async () => {
    const first = deferred<Awaited<ReturnType<typeof api.getHomePage>>>();
    vi.mocked(api.getHomePage).mockReturnValueOnce(first.promise).mockResolvedValueOnce({ sections: [section('focus')], continuation: null });
    const pending = service.loadHome();
    await settle();
    await service.selectHomeFilter({ label: 'Focus', browseId: 'FEmusic_home', params: 'focus' });
    first.resolve({ sections: [section('old')], continuation: 'old-token' });
    await pending;
    expect(get(service.homeSectionsStore)).toEqual([section('focus')]);
    expect(get(service.homeContinuationStore)).toBeNull();
  });
  it('does not append streamed playlist pages after sign-out', async () => {
    const song = (videoId: string): Track => ({ videoId, title: videoId, artists: [], thumbnails: [] });
    const stream = deferred<Track[]>();
    let onPage!: (tracks: Track[], done: boolean) => void;
    vi.mocked(api.streamCollectionTracks).mockImplementationOnce((_id, _session, callback) => {
      onPage = callback;
      return stream.promise;
    });
    const pending = service.playPlaylist(playlist('songs'));
    await settle();
    onPage([song('a')], false);
    expect(playTracks).toHaveBeenCalledOnce();
    authStore.set(null);
    onPage([song('a'), song('b')], true);
    stream.resolve([song('a'), song('b')]);
    await pending;
    expect(get(queueItems)).toEqual([]);
    expect(playTracks).toHaveBeenCalledOnce();
  });

  it('can load after a signed-out request instead of retaining a resolved guard', async () => {
    authStore.set(null);
    await service.loadLibrary();
    authStore.set(session);
    await service.loadLibrary();
    expect(get(service.playlistStore)).toEqual([playlist('new')]);
  });

  it('clears startup session data and ignores results arriving after sign-out', async () => {
    await Promise.all([service.loadLibrary(), service.loadHome()]);
    const library = deferred<Playlist[]>();
    const home = deferred<HomeSection[]>();
    vi.mocked(api.getLibraryPlaylists).mockReturnValueOnce(library.promise);
    vi.mocked(api.getHomeSections).mockReturnValueOnce(home.promise);
    const pending = Promise.all([service.loadLibrary(), service.loadHome()]);
    await settle();
    authStore.set(null);
    expect(get(service.playlistStore)).toEqual([]);
    expect(get(service.homeSectionsStore)).toEqual([]);
    library.resolve([playlist('old')]);
    home.resolve([section('old')]);
    await pending;
    expect(get(service.playlistStore)).toEqual([]);
    expect(get(service.homeSectionsStore)).toEqual([]);
  });

  it('keeps refreshed results when earlier channel requests finish later', async () => {
    const library = deferred<Playlist[]>();
    const home = deferred<HomeSection[]>();
    vi.mocked(api.getLibraryPlaylists).mockReturnValueOnce(library.promise);
    vi.mocked(api.getHomeSections).mockReturnValueOnce(home.promise);
    const old = Promise.all([service.loadLibrary(), service.loadHome()]);
    await settle();
    vi.mocked(api.getActiveChannel).mockReturnValue('next-channel');
    await service.reloadAll();
    library.resolve([playlist('old')]);
    home.resolve([section('old')]);
    await old;
    expect(get(service.playlistStore)).toEqual([playlist('new')]);
    expect(get(service.homeSectionsStore)).toEqual([section('new')]);
  });

  it('does not let stale failures clear a newer request guard or loading state', async () => {
    const oldResult = deferred<Playlist[]>();
    const newResult = deferred<Playlist[]>();
    vi.mocked(api.getLibraryPlaylists).mockReturnValueOnce(oldResult.promise).mockReturnValueOnce(newResult.promise);
    const old = service.loadLibrary();
    await settle();
    const fresh = service.reloadAll();
    await settle();
    oldResult.reject(new Error('old request failed'));
    await old;
    expect(get(service.libraryLoading)).toBe(true);
    expect(get(service.libraryError)).toBeNull();
    const sameRequest = service.loadLibrary();
    expect(api.getLibraryPlaylists).toHaveBeenCalledTimes(2);
    newResult.resolve([playlist('new')]);
    await Promise.all([fresh, sameRequest]);
    expect(get(service.libraryLoading)).toBe(false);
    expect(get(service.playlistStore)).toEqual([playlist('new')]);
  });
});


it('restores edit controls from the playlist header even when the menu omitted it', async () => {
  vi.mocked(api.getPlaylistMeta).mockResolvedValueOnce({ canEdit: true, title: 'Owned' });
  vi.mocked(api.streamCollectionTracks).mockResolvedValueOnce([]);
  await service.loadOpenPlaylist(playlist('VLNEW'));
  expect(api.getPlaylistMeta, String(get(service.openPlaylistError))).toHaveBeenCalled();
  const { addPlaylistLocally } = await import('./addablePlaylists');
  await vi.waitFor(() => expect(addPlaylistLocally).toHaveBeenCalledWith(expect.objectContaining({ browseId: 'VLNEW', title: 'Owned' })));
});
it('does not infer ownership from a regular playlist header', async () => {
  vi.mocked(api.getPlaylistMeta).mockResolvedValueOnce({ title: 'Saved' });
  vi.mocked(api.streamCollectionTracks).mockResolvedValueOnce([]);
  await service.loadOpenPlaylist(playlist('VLSAVED'));
  const { addPlaylistLocally } = await import('./addablePlaylists');
  await settle(); expect(addPlaylistLocally).not.toHaveBeenCalled();
});


it('refreshes an edited open playlist without clearing its content or reloading the library', async () => {
  const song = (videoId: string): Track => ({ videoId, title: videoId, artists: [], thumbnails: [] });
  const target = { ...playlist('VLEDIT'), trackCount: 1 };
  service.playlistStore.set([target, playlist('OTHER')]);
  service.openPlaylistStore.set(target); service.openPlaylistTracks.set([song('old')]);
  service.openPlaylistLoading.set(false);
  const response = deferred<Track[]>();
  vi.mocked(api.streamCollectionTracks).mockReturnValueOnce(response.promise);
  vi.mocked(api.getPlaylistMeta).mockResolvedValueOnce({ title: 'Updated', thumbnails: [{ url: 'https://image.test/new-art' }] });
  const refresh = service.refreshEditedPlaylist(target, [song('added')]);
  await settle();
  expect(get(service.openPlaylistTracks).map(track => track.videoId)).toEqual(['old', 'added']);
  expect(get(service.openPlaylistLoading)).toBe(false);
  response.resolve([song('old'), song('added')]); await refresh;
  expect(get(service.playlistStore)[0]).toMatchObject({ title: 'Updated', trackCount: 2, thumbnails: [{ url: 'https://image.test/new-art' }] });
  expect(get(service.playlistStore)[1]).toEqual(playlist('OTHER'));
  expect(api.getLibraryPlaylists).not.toHaveBeenCalled();
});
it('refreshes only the changed playlist header when another playlist is open', async () => {
  const target = { ...playlist('TARGET'), trackCount: 2 };
  service.playlistStore.set([target]);
  service.openPlaylistStore.set(playlist('OTHER')); service.openPlaylistTracks.set([]);
  vi.mocked(api.getPlaylistMeta).mockResolvedValueOnce({ thumbnails: [{ url: 'https://image.test/target' }] });
  await service.refreshEditedPlaylist(target, [{ videoId: 'song', title: 'Song', artists: [], thumbnails: [] }]);
  expect(api.getPlaylistMeta).toHaveBeenCalledWith('TARGET', session);
  expect(api.streamCollectionTracks).not.toHaveBeenCalled();
  expect(get(service.openPlaylistStore)?.browseId).toBe('OTHER');
  expect(get(service.playlistStore)[0]).toMatchObject({ trackCount: 3, thumbnails: [{ url: 'https://image.test/target' }] });
});
