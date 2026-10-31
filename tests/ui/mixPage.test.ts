import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import MixView from '../../src/lib/ui/views/MixView.svelte';
import { getRadioPage } from '../../src/lib/infra/ytmusic/InnertubeClient';
import { playRadio } from '../../src/lib/app/services/radio';
import { authIdentity } from '../../src/lib/infra/ytmusic/authContext';

const endpoint = { playlistId: 'RDpersonal', params: 'private-mix' };
const session = { kind: 'cookie' as const, cookie: 'SID=synthetic', savedAt: 0 };
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({ getRadioPage: vi.fn(), getActiveChannel: () => 'brand' }));
vi.mock('$lib/app/services/auth', async () => ({ authStore: (await import('svelte/store')).writable({ kind: 'cookie', cookie: 'SID=synthetic', savedAt: 0 }) }));
vi.mock('$lib/app/services/account', async () => ({ activeChannelStore: (await import('svelte/store')).writable({ pageId: 'brand' }) }));
vi.mock('$lib/app/services/navigation', async () => ({ pageStore: (await import('svelte/store')).writable({ view: 'browse', entity: { kind: 'mix', browseId: 'RDpersonal', title: 'Personal mix', endpoint: { playlistId: 'RDpersonal', params: 'private-mix' } } }) }));
vi.mock('$lib/app/services/radio', () => ({ playRadio: vi.fn() }));
vi.mock('$lib/app/services/player', async () => ({ playerStore: (await import('svelte/store')).writable({ track: null, status: 'paused' }) }));
vi.mock('$lib/app/services/menus', () => ({ trackMenu: vi.fn(() => []) }));
vi.mock('$lib/app/services/catalog', () => ({ openArtist: vi.fn() }));
let target: HTMLDivElement;
let component: ReturnType<typeof mount>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  target = document.createElement('div'); document.body.append(target);
});
afterEach(async () => { await unmount(component); target.remove(); vi.unstubAllGlobals(); });
const track = (videoId: string) => ({ videoId, title: videoId, artists: [], thumbnails: [] });

it('opens a mix without playback, then plays the selected row using its loaded tracks', async () => {
  const page = { tracks: [track('first'), track('second')], continuation: 'more', playlistId: 'RDpersonal' };
  vi.mocked(getRadioPage).mockResolvedValueOnce(page);
  component = mount(MixView, { target });
  await vi.waitFor(() => expect(target.textContent).toContain('second'));
  expect(getRadioPage).toHaveBeenCalledExactlyOnceWith(endpoint, session);
  expect(playRadio).not.toHaveBeenCalled();
  target.querySelectorAll<HTMLElement>('[role="button"]')[1].click();
  expect(playRadio).toHaveBeenCalledWith(endpoint, { title: 'Personal mix', startAt: 1,
    initial: { page, account: authIdentity(session), channel: 'brand' } });
});

it('appends mix continuations without duplicates or starting playback', async () => {
  vi.mocked(getRadioPage).mockResolvedValueOnce({ tracks: [track('first')], continuation: 'next' })
    .mockResolvedValueOnce({ tracks: [track('first'), track('second')], continuation: 'next' });
  component = mount(MixView, { target });
  await vi.waitFor(() => expect(target.textContent).toContain('first'));
  Array.from(target.querySelectorAll('button')).find(button => button.textContent === 'More')!.click();
  await vi.waitFor(() => expect(target.textContent).toContain('second'));
  expect(target.querySelectorAll('[role="listitem"]')).toHaveLength(2);
  expect(getRadioPage).toHaveBeenLastCalledWith(endpoint, session, 'next');
  expect(Array.from(target.querySelectorAll('button')).some(button => button.textContent === 'More')).toBe(false);
  expect(playRadio).not.toHaveBeenCalled();
});
