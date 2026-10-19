import { beforeEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
vi.mock('./auth', async () => ({ authStore: (await import('svelte/store')).writable(null) }));
vi.mock('./account', async () => ({ activeChannelStore: (await import('svelte/store')).writable(null) }));
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({ getBrowsePage: vi.fn(), getActiveChannel: () => get(activeChannelStore)?.pageId ?? '' }));
import { authStore } from './auth';
import { activeChannelStore } from './account';
import { repeatListeningStore, warmProfileGreetings } from './profilePersonalization';
import { getBrowsePage } from '$lib/infra/ytmusic/InnertubeClient';
import type { HomeSection } from '$lib/infra/ytmusic/rawHome';

const home: HomeSection[] = [{ title: 'Listen again', cards: [], songs: [], header: { thumbnails: [], profile: { browseId: 'UCowner', params: 'own-profile' } } }];
const repeats: HomeSection[] = [{ title: 'Artists on repeat', songs: [], cards: [{ browseId: 'UCartist', title: 'Artist A', thumbnails: [] }] }];
beforeEach(() => {
  authStore.set(null); activeChannelStore.set(null); vi.clearAllMocks();
  authStore.set({ kind: 'cookie', cookie: 'SID=test', savedAt: 0 });
  activeChannelStore.set({ name: 'SAME', pageId: 'brand' });
});

it('clears private listening hints when switching channels or signing out', () => {
  authStore.set({ kind: 'cookie', cookie: 'SID=test', savedAt: 0 });
  activeChannelStore.set({ name: 'First channel', pageId: 'first' });
  repeatListeningStore.set({ artists: ['Artist A'], songs: ['Song A'], playlists: [] });
  activeChannelStore.set({ name: 'Second channel', pageId: 'second' });
  expect(get(repeatListeningStore)).toEqual({ artists: [], songs: [], playlists: [] });
  repeatListeningStore.set({ artists: ['Artist B'], songs: [], playlists: ['Playlist B'] });
  authStore.set(null);
  expect(get(repeatListeningStore)).toEqual({ artists: [], songs: [], playlists: [] });
});

it('requests the own-profile endpoint only once, preserving its parameters', async () => {
  vi.mocked(getBrowsePage).mockResolvedValue({ sections: repeats, continuation: null });
  await Promise.all([warmProfileGreetings(home), warmProfileGreetings(home)]);
  await warmProfileGreetings(home);
  expect(getBrowsePage).toHaveBeenCalledExactlyOnceWith('UCowner', get(authStore), 'own-profile');
  expect(get(repeatListeningStore).artists).toEqual(['Artist A']);
});

it('uses existing Home repeat shelves without another request', async () => {
  await warmProfileGreetings(repeats);
  expect(getBrowsePage).not.toHaveBeenCalled();
  expect(get(repeatListeningStore).artists).toEqual(['Artist A']);
});

it('waits for sign-in/channel readiness and can warm each channel once', async () => {
  activeChannelStore.set(null);
  await warmProfileGreetings(home);
  expect(getBrowsePage).not.toHaveBeenCalled();
  vi.mocked(getBrowsePage).mockResolvedValue({ sections: repeats, continuation: null });
  activeChannelStore.set({ name: 'First', pageId: 'UCfirst' });
  await warmProfileGreetings([]);
  activeChannelStore.set({ name: 'Second', pageId: 'UCsecond' });
  await warmProfileGreetings([]);
  activeChannelStore.set({ name: 'First', pageId: 'UCfirst' });
  await warmProfileGreetings([]);
  expect(getBrowsePage).toHaveBeenCalledTimes(2);
  expect(getBrowsePage).toHaveBeenNthCalledWith(1, 'UCfirst', get(authStore), undefined);
  expect(getBrowsePage).toHaveBeenNthCalledWith(2, 'UCsecond', get(authStore), undefined);
});

it('does not retry failed requests and discards responses from a previous channel', async () => {
  vi.mocked(getBrowsePage).mockRejectedValueOnce(new Error('offline'));
  await warmProfileGreetings(home); await warmProfileGreetings(home);
  expect(getBrowsePage).toHaveBeenCalledTimes(1);
  activeChannelStore.set({ name: 'Other', pageId: 'other' });
  let resolve!: (value: Awaited<ReturnType<typeof getBrowsePage>>) => void;
  vi.mocked(getBrowsePage).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const pending = warmProfileGreetings(home);
  authStore.set(null);
  resolve({ sections: repeats, continuation: null });
  await pending;
  expect(get(repeatListeningStore)).toEqual({ artists: [], songs: [], playlists: [] });
});
