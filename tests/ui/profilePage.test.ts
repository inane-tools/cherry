import { afterEach, expect, it, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import BrowseView from '../../src/lib/ui/views/BrowseView.svelte';
import { getBrowsePage } from '../../src/lib/infra/ytmusic/InnertubeClient';
import { playRadio } from '../../src/lib/app/services/radio';
import { selectCarouselEntry } from '../../src/lib/app/services/browse';
import type { HomeSection } from '../../src/lib/infra/ytmusic/rawHome';
import { pageStore } from '../../src/lib/app/services/navigation';
import { pageVisitStore } from '../../src/lib/app/services/pageVisit';

vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({ getBrowsePage: vi.fn(), getActiveChannel: () => 'brand' }));
vi.mock('$lib/app/services/auth', async () => ({ authStore: (await import('svelte/store')).writable({ kind: 'cookie', cookie: 'SID=synthetic', savedAt: 0 }) }));
vi.mock('$lib/app/services/account', async () => ({ activeChannelStore: (await import('svelte/store')).writable({ name: 'SAME', pageId: 'brand' }) }));
vi.mock('$lib/app/services/navigation', async () => ({ pageStore: (await import('svelte/store')).writable({ view: 'browse', entity: { browseId: 'UCowner', title: 'Profile', params: 'own-profile', kind: 'profile' } }) }));
vi.mock('$lib/app/services/browse', () => ({ entriesOf: (section: HomeSection) => section.cards.map(card => ({ ...card, key: `c:${card.browseId}`, kind: 'card' })), selectCarouselEntry: vi.fn(), playCarouselEntry: vi.fn(), openCarouselMenu: vi.fn(), openBrowseCard: vi.fn(), openProfile: vi.fn() }));
vi.mock('$lib/app/services/radio', () => ({ playRadio: vi.fn() }));
vi.mock('$lib/app/services/links', () => ({ copyText: vi.fn() }));
vi.mock('$lib/app/services/contextMenu', () => ({ notify: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

it('loads a signed-in profile with its parameters, plays the server mix, and follows continuation', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const endpoint = { playlistId: 'RDpersonal', params: 'private-mix' };
  vi.mocked(getBrowsePage).mockResolvedValueOnce({ sections: [], continuation: 'next-profile', header: {
    title: 'SAME', thumbnails: [{ url: 'https://image.test/avatar' }], banner: [{ url: 'https://image.test/banner' }],
    actions: [{ label: 'Play personal mix', playback: endpoint }],
  } }).mockResolvedValueOnce({ sections: [], continuation: null });
  const target = document.createElement('div'); document.body.appendChild(target);
  const component = mount(BrowseView, { target });
  try {
    await vi.waitFor(() => expect(target.querySelector('h1')?.textContent).toBe('SAME'));
    expect(getBrowsePage).toHaveBeenNthCalledWith(1, 'UCowner', expect.objectContaining({ cookie: 'SID=synthetic' }), 'own-profile', undefined);
    const play = target.querySelector<HTMLButtonElement>('header [aria-label="Play personal mix"]')!;
    expect(play).not.toBeNull();
    play.click();
    expect(playRadio).toHaveBeenCalledExactlyOnceWith(endpoint);
    const more = Array.from(target.querySelectorAll('button')).find(button => button.textContent === 'More')!;
    more.click();
    await vi.waitFor(() => expect(getBrowsePage).toHaveBeenCalledTimes(2));
    expect(getBrowsePage).toHaveBeenLastCalledWith('UCowner', expect.objectContaining({ cookie: 'SID=synthetic' }), 'own-profile', 'next-profile');
    expect(target.querySelector('h1')?.textContent).toBe('SAME');
  } finally { await unmount(component); target.remove(); }
});

it('moves the personal mix shelf into the header without a duplicate shelf or play action', async () => {
  const mix: HomeSection = { title: 'Personal mix', cards: [{ title: 'Personal mix', browseId: 'station:mix', thumbnails: [{ url: 'https://image.test/mix' }], playback: { playlistId: 'RDmix' } }], songs: [] };
  vi.mocked(getBrowsePage).mockResolvedValueOnce({ sections: [mix], continuation: null, header: {
    title: 'SAME', thumbnails: [], actions: [{ label: 'Play personal mix', playback: { playlistId: 'RDmix' } }],
  } });
  const target = document.createElement('div'); document.body.append(target);
  const component = mount(BrowseView, { target });
  try {
    await vi.waitFor(() => expect(target.querySelector('header [aria-label="Play personal mix"]')).not.toBeNull());
    const card = target.querySelector<HTMLButtonElement>('header [aria-label="Play personal mix"]')!;
    expect(card.querySelector('img')?.src).toBe('https://image.test/mix');
    expect(target.querySelectorAll('[aria-label="Play personal mix"]')).toHaveLength(1);
    expect(target.querySelector('h2')).toBeNull();
    card.click();
    expect(selectCarouselEntry).toHaveBeenCalledWith(mix, expect.objectContaining({ playback: { playlistId: 'RDmix' } }));
  } finally { await unmount(component); target.remove(); }
});

it('loads a profile shelf independently, retries a failure, and stops a repeated token', async () => {
  const scrollBy = vi.fn();
  const originalScrollBy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollBy');
  Object.defineProperty(HTMLElement.prototype, 'scrollBy', { configurable: true, value: scrollBy });
  const card = (id: string) => ({ title: id, browseId: `VL${id}`, thumbnails: [] });
  vi.mocked(getBrowsePage)
    .mockResolvedValueOnce({ sections: [{ title: 'Public playlists', cards: [card('first')], songs: [], continuation: 'shelf-next' }], continuation: 'page-next', header: { title: 'SAME', thumbnails: [] } })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ sections: [{ title: '', cards: [card('first'), card('second')], songs: [], continuation: 'shelf-next' }], continuation: null });
  const target = document.createElement('div'); document.body.append(target);
  const component = mount(BrowseView, { target });
  try {
    await vi.waitFor(() => expect(target.querySelector('[aria-label="Load more items"]')).not.toBeNull());
    target.querySelector<HTMLButtonElement>('[aria-label="Load more items"]')!.click();
    await vi.waitFor(() => expect(target.querySelector('[role="alert"]')?.textContent).toContain('Could not load more items'));
    expect(target.querySelector('[aria-label="Open first"]')).not.toBeNull();
    target.querySelector<HTMLButtonElement>('[aria-label="Load more items"]')!.click();
    await vi.waitFor(() => expect(target.querySelector('[aria-label="Open second"]')).not.toBeNull());
    await tick();
    expect(getBrowsePage).toHaveBeenLastCalledWith('UCowner', expect.anything(), 'own-profile', 'shelf-next');
    expect(target.querySelectorAll('[aria-label="Open first"]')).toHaveLength(1);
    expect(target.querySelector('[aria-label="Load more items"]')).toBeNull();
    expect(target.querySelector('h1')?.textContent).toBe('SAME');
    expect(Array.from(target.querySelectorAll('button')).some(button => button.textContent === 'More')).toBe(true);
  } finally {
    await unmount(component); target.remove();
    if (originalScrollBy) Object.defineProperty(HTMLElement.prototype, 'scrollBy', originalScrollBy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollBy');
  }
});

it('uses a shelf More endpoint and retains its parameters when there is no continuation yet', async () => {
  const originalScrollBy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollBy');
  Object.defineProperty(HTMLElement.prototype, 'scrollBy', { configurable: true, value: vi.fn() });
  const card = (id: string) => ({ title: id, browseId: `VL${id}`, thumbnails: [] });
  vi.mocked(getBrowsePage)
    .mockResolvedValueOnce({ sections: [{ title: 'Public playlists', cards: [card('preview')], songs: [], header: { thumbnails: [], more: { browseId: 'UCowner', params: 'all-public-playlists' } } }], continuation: null })
    .mockResolvedValueOnce({ sections: [{ title: '', cards: [card('more')], songs: [] }], continuation: null });
  const target = document.createElement('div'); document.body.append(target);
  const component = mount(BrowseView, { target });
  try {
    await vi.waitFor(() => expect(target.querySelector('[aria-label="Load more items"]')).not.toBeNull());
    target.querySelector<HTMLButtonElement>('[aria-label="Load more items"]')!.click();
    await vi.waitFor(() => expect(target.querySelector('[aria-label="Open more"]')).not.toBeNull());
    expect(getBrowsePage).toHaveBeenLastCalledWith('UCowner', expect.anything(), 'all-public-playlists', undefined);
  } finally {
    await unmount(component); target.remove();
    if (originalScrollBy) Object.defineProperty(HTMLElement.prototype, 'scrollBy', originalScrollBy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollBy');
  }
});

it('renders a collection subpage as one wrapping grid and appends its continuation there', async () => {
  pageStore.set({ view: 'browse', entity: { browseId: 'FEcollection', title: 'From your library', params: 'collection' } });
  const card = (id: string) => ({ title: id, browseId: `VL${id}`, thumbnails: [] });
  vi.mocked(getBrowsePage)
    .mockResolvedValueOnce({ sections: [{ title: 'From your library', presentation: 'grid', cards: [card('first')], songs: [], continuation: 'grid-next' }], continuation: null })
    .mockResolvedValueOnce({ sections: [{ title: '', presentation: 'grid', cards: [card('first'), card('second')], songs: [] }], continuation: null });
  const target = document.createElement('div'); document.body.append(target);
  const component = mount(BrowseView, { target });
  try {
    await vi.waitFor(() => expect(target.querySelector('[aria-label="Open first"]')).not.toBeNull());
    expect(target.querySelector('h1')?.textContent).toBe('From your library');
    expect(target.querySelector('h2')).toBeNull();
    expect(target.querySelector('[aria-label="Scroll right"]')).toBeNull();
    expect(target.querySelector('.cherry-carousel')).toBeNull();
    target.querySelector<HTMLButtonElement>('[aria-label="Load more From your library"]')!.click();
    await vi.waitFor(() => expect(target.querySelector('[aria-label="Open second"]')).not.toBeNull());
    expect(target.querySelectorAll('[aria-label="Open first"]')).toHaveLength(1);
    expect(target.querySelectorAll('section')).toHaveLength(1);
    expect(getBrowsePage).toHaveBeenLastCalledWith('FEcollection', expect.anything(), 'collection', 'grid-next');
  } finally {
    await unmount(component); target.remove();
    pageStore.set({ view: 'browse', entity: { browseId: 'UCowner', title: 'Profile', params: 'own-profile', kind: 'profile' } });
  }
});

it('restores already-loaded Explore sections and pagination when returning through history', async () => {
  const visit = {};
  pageVisitStore.set({ token: visit, restore: false }); pageStore.set({ view: 'explore' });
  const shelf = (id: string): HomeSection => ({ title: id, cards: [{ title: id, browseId: `VL${id}`, thumbnails: [] }], songs: [] });
  vi.mocked(getBrowsePage).mockClear();
  vi.mocked(getBrowsePage).mockResolvedValueOnce({ sections: [shelf('first')], continuation: 'next-explore' })
    .mockResolvedValueOnce({ sections: [shelf('second')], continuation: 'third-explore' });
  const target = document.createElement('div'); document.body.append(target);
  let component = mount(BrowseView, { target });
  try {
    await vi.waitFor(() => expect(target.querySelector('[aria-label="Open first"]')).not.toBeNull());
    Array.from(target.querySelectorAll('button')).find(button => button.textContent === 'More recommendations')!.click();
    await vi.waitFor(() => expect(target.querySelector('[aria-label="Open second"]')).not.toBeNull());
    await unmount(component);
    pageVisitStore.set({ token: visit, restore: true });
    component = mount(BrowseView, { target }); await tick();
    expect(target.querySelector('[aria-label="Open first"]')).not.toBeNull();
    expect(target.querySelector('[aria-label="Open second"]')).not.toBeNull();
    expect(getBrowsePage).toHaveBeenCalledTimes(2);
    expect(Array.from(target.querySelectorAll('button')).some(button => button.textContent === 'More recommendations')).toBe(true);
  } finally {
    await unmount(component); target.remove();
    pageVisitStore.set({ token: {}, restore: false });
    pageStore.set({ view: 'browse', entity: { browseId: 'UCowner', title: 'Profile', params: 'own-profile', kind: 'profile' } });
  }
});
