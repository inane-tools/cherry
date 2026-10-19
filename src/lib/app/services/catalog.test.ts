import { beforeEach, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';
import type { Page } from './navigation';
import type { ArtistPage } from '$lib/infra/ytmusic/InnertubeClient';
vi.mock('./auth', () => ({ authStore: writable(null) }));
vi.mock('./navigation', () => ({ openPage: vi.fn(), pageStore: writable<Page>({ view: 'home' }) }));
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({ getArtistPage: vi.fn(), getAlbumPage: vi.fn() }));
import { pageStore } from './navigation';
import { getArtistPage } from '$lib/infra/ytmusic/InnertubeClient';
import { loadArtistPage } from './catalog';
const artist = { name: 'Artist', browseId: 'UCartist' };
const details: ArtistPage = { title: 'Artist', thumbnails: [{ url: 'https://image.test/portrait' }], sections: [] };
beforeEach(() => { vi.clearAllMocks(); pageStore.set({ view: 'artist', entity: artist }); });

it('passes the fetched artist portrait to the current navigation header without navigating', async () => {
  vi.mocked(getArtistPage).mockResolvedValueOnce(details);
  await loadArtistPage(artist);
  expect(get(pageStore)).toEqual({ view: 'artist', entity: { ...artist, thumbnails: details.thumbnails } });
});

it('does not put an old artist portrait into a different page', async () => {
  let finish!: (details: ArtistPage) => void;
  vi.mocked(getArtistPage).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const loading = loadArtistPage(artist);
  pageStore.set({ view: 'artist', entity: { name: 'Other', browseId: 'UCother' } });
  finish(details); await loading;
  expect(get(pageStore)).toEqual({ view: 'artist', entity: { name: 'Other', browseId: 'UCother' } });
});
