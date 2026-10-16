import { beforeEach, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';
import { clearQueue, setQueue, queueItems } from './queue';
const mocks = vi.hoisted(() => ({ page: vi.fn(), play: vi.fn() }));
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({ getRadioPage: mocks.page, getActiveChannel: () => 'channel' }));
vi.mock('./auth', () => ({ authStore: writable<unknown>({ cookie: 'session' }) }));
vi.mock('./player', () => ({ playTracks: mocks.play, playerStore: writable({ status: 'playing', track: null }) }));
vi.mock('./contextMenu', () => ({ notify: vi.fn() }));
import { authStore } from './auth';
import { playerStore } from './player';
import { playRadio, startRadioRefill } from './radio';
const track = (videoId: string) => ({ videoId, title: videoId, artists: [], thumbnails: [] });
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
beforeEach(() => {
  clearQueue(); vi.clearAllMocks(); authStore.set({ cookie: 'session' } as any);
  mocks.play.mockImplementation(async tracks => { setQueue(tracks); });
});
it('retains the server station endpoint, refills and ignores duplicate tracks and repeated tokens', async () => {
  const stop = startRadioRefill();
  try {
    mocks.page.mockResolvedValueOnce({ tracks: [track('a'), track('b')], playlistId: 'RDactual', continuation: 'next' })
      .mockResolvedValueOnce({ tracks: [track('b'), track('c')], continuation: 'next' });
    await playRadio({ videoId: 'seed', playlistId: 'RDstation', params: 'server' });
    playerStore.update(s => ({ ...s, status: 'playing' })); await flush();
    expect(mocks.page).toHaveBeenLastCalledWith({ videoId: 'seed', playlistId: 'RDactual', params: 'server' }, expect.anything(), 'next');
    expect(get(queueItems).map(item => item.track.videoId)).toEqual(['a', 'b', 'c']);
    playerStore.update(s => ({ ...s })); await flush();
    expect(mocks.page).toHaveBeenCalledTimes(2);
  } finally { stop(); }
});
it('does not replace a newer manual queue when a slow station request returns', async () => {
  const stop = startRadioRefill();
  try {
    let resolve!: (value: unknown) => void;
    mocks.page.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const request = playRadio({ playlistId: 'RDstation' });
    setQueue([track('manual')]);
    resolve({ tracks: [track('station')] }); await request;
    expect(mocks.play).not.toHaveBeenCalled();
    expect(get(queueItems)[0].track.videoId).toBe('manual');
  } finally { stop(); }
});
it('ignores a refill response after signing out', async () => {
  const stop = startRadioRefill();
  try {
    let resolve!: (value: unknown) => void;
    mocks.page.mockResolvedValueOnce({ tracks: [track('a')], continuation: 'next' })
      .mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await playRadio({ playlistId: 'RDstation' });
    playerStore.update(s => ({ ...s, status: 'playing' }));
    authStore.set(null); resolve({ tracks: [track('stale')] }); await flush();
    expect(get(queueItems).map(item => item.track.videoId)).toEqual(['a']);
  } finally { stop(); }
});
