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
  getLibraryPlaylists: vi.fn(), getHomeSections: vi.fn(), getHomePage: vi.fn(), getBrowsePage: vi.fn(),
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
  vi.mocked(api.getBrowsePage).mockReset().mockResolvedValue({ sections: [], continuation: null });
});

describe('Home profile and native ordering', () => {
  const recent = { ...section('Listen again'), songs: [{ videoId: 'recent', title: 'Recent', thumbnails: [] }] };
  it('keeps YouTube order and does not fetch history, even without Listen again', async () => {
    vi.mocked(api.getHomePage).mockResolvedValueOnce({ sections: [section('Recommendations'), recent], continuation: null });
    await service.loadHome();
    expect(get(service.homeSectionsStore)).toEqual([section('Recommendations'), recent]);
    vi.mocked(api.getHomePage).mockResolvedValueOnce({ sections: [section('Other')], continuation: null });
    await service.loadHome();
    expect(get(service.homeSectionsStore)).toEqual([section('Other')]);
    expect(api.getBrowsePage).not.toHaveBeenCalled();
  });
  it('uses the account avatar on the first section and a later shelf only for its profile endpoint', async () => {
    vi.mocked(initChannel).mockResolvedValueOnce({ name: 'Owner', pageId: 'UCowner', avatarUrl: 'https://image.test/account' });
    const first = { ...section('Recommendations'), songs: recent.songs };
    const later = { ...recent, header: { thumbnails: [{ url: 'https://image.test/ignore' }], profile: { browseId: 'UCowner', params: 'private' } } };
    vi.mocked(api.getHomePage).mockResolvedValueOnce({ sections: [first], continuation: 'more' }).mockResolvedValueOnce({ sections: [later], continuation: null });
    await service.loadHome(); await service.loadMoreHome();
    const shelves = get(service.homeSectionsStore);
    expect(shelves.map(s => s.title)).toEqual(['Recommendations', 'Listen again']);
    expect(shelves[0].header).toMatchObject({ thumbnails: [{ url: 'https://image.test/account' }], profile: { browseId: 'UCowner', params: 'private' } });
    expect(shelves[1].header?.thumbnails).toEqual([]);
    expect(api.getBrowsePage).not.toHaveBeenCalled();
  });
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

it('fills in the creator for a Home card in both the open playlist and navigation header', async () => {
  const target = playlist('VLHOME');
  service.openPlaylist(target);
  vi.mocked(api.getPlaylistMeta).mockResolvedValueOnce({ title: 'Curated playlist', author: 'The curator' });
  vi.mocked(api.streamCollectionTracks).mockResolvedValueOnce([]);
  await service.loadOpenPlaylist(target);
  const { pageStore } = await import('./navigation');
  expect(get(service.openPlaylistStore)).toMatchObject({ author: 'The curator' });
  expect(get(pageStore)).toMatchObject({ view: 'playlist', entity: { title: 'Curated playlist', author: 'The curator' } });
});

it('keeps header details loading until creator metadata is ready, independently of streamed tracks', async () => {
  const header = deferred<Awaited<ReturnType<typeof api.getPlaylistMeta>>>();
  vi.mocked(api.getPlaylistMeta).mockReturnValueOnce(header.promise);
  vi.mocked(api.streamCollectionTracks).mockResolvedValueOnce([]);
  await service.loadOpenPlaylist(playlist('HEADER'));
  expect(get(service.openPlaylistHeaderLoading)).toBe(true);
  expect(get(service.openPlaylistLoading)).toBe(false);
  header.resolve({ author: 'The curator', description: 'Description' });
  await settle();
  expect(get(service.openPlaylistHeaderLoading)).toBe(false);
  expect(get(service.openPlaylistStore)?.author).toBe('The curator');
  expect(get(service.openPlaylistDescription)).toBe('Description');
});

it('removes only the confirmed playlist occurrence and updates counts without changing the queue', () => {
  const first = { videoId: 'same', title: 'Same', artists: [], thumbnails: [], playlistEntryId: 'first' };
  const second = { ...first, playlistEntryId: 'second' };
  const target = { ...playlist('REMOVE'), trackCount: 2 };
  service.openPlaylistStore.set(target); service.openPlaylistTracks.set([first, second]); service.playlistStore.set([target]);
  const before = get(queueItems);
  service.recordPlaylistRemoval(target, second);
  expect(get(service.openPlaylistTracks)).toEqual([first]);
  expect(get(service.openPlaylistStore)?.trackCount).toBe(1);
  expect(get(service.playlistStore)[0].trackCount).toBe(1);
  expect(get(queueItems)).toBe(before);
});

it('does not resurrect a removed entry while later playlist pages are still streaming', async () => {
  const song = (playlistEntryId: string): Track => ({ videoId: 'same', title: 'Song', artists: [], thumbnails: [], playlistEntryId });
  const first = song('first'), second = song('second'), third = song('third');
  const response = deferred<Track[]>();
  let page!: (tracks: Track[], done: boolean) => void;
  vi.mocked(api.streamCollectionTracks).mockImplementationOnce((_id, _session, onPage) => { page = onPage; return response.promise; });
  const target = playlist('STREAM');
  const loading = service.loadOpenPlaylist(target);
  await settle();
  page([first, second], false);
  service.recordPlaylistRemoval(target, second);
  page([first, second, third], false);
  expect(get(service.openPlaylistTracks)).toEqual([first, third]);
  response.resolve([first, second, third]); await loading;
  expect(get(service.openPlaylistTracks)).toEqual([first, third]);
  expect(get(service.openPlaylistStore)?.trackCount).toBe(2);
});

it('ignores creator metadata from a playlist that has been replaced', async () => {
  const old = deferred<Awaited<ReturnType<typeof api.getPlaylistMeta>>>();
  vi.mocked(api.getPlaylistMeta).mockReturnValueOnce(old.promise).mockResolvedValueOnce({ author: 'New curator' });
  vi.mocked(api.streamCollectionTracks).mockResolvedValue([]);
  await service.loadOpenPlaylist(playlist('OLD'));
  await service.loadOpenPlaylist(playlist('NEW'));
  old.resolve({ author: 'Old curator' });
  await settle();
  expect(get(service.openPlaylistStore)).toMatchObject({ browseId: 'NEW', author: 'New curator' });
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
