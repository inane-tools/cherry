import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import SearchView from '../../src/lib/ui/views/SearchView.svelte';
import { resetSearchSession } from '../../src/lib/app/services/searchSession';
import { searchAll } from '../../src/lib/infra/ytmusic/InnertubeClient';
import { resolveParsedLink } from '../../src/lib/app/services/openLink';
import type { SearchResults } from '../../src/lib/core/models';

vi.mock('$lib/app/services/navigation', async () => {
  const session = await import('../../src/lib/app/services/searchSession');
  return { ...session, requestSearch: (query: string) => session.searchRequest.update(current => ({ query, id: current.id + 1 })) };
});
vi.mock('$lib/app/services/auth', async () => ({ authStore: (await import('svelte/store')).writable({ cookie: 'SID=fixture' }) }));
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({ searchAll: vi.fn() }));
vi.mock('$lib/app/services/openLink', async importOriginal => ({ ...await importOriginal<typeof import('../../src/lib/app/services/openLink')>(), resolveParsedLink: vi.fn() }));
vi.mock('$lib/app/services/player', async () => ({ playTracks: vi.fn(), playerStore: (await import('svelte/store')).writable({ track: null, status: 'idle' }) }));
vi.mock('$lib/app/services/catalog', () => ({ openAlbum: vi.fn(), openArtist: vi.fn() }));
vi.mock('$lib/app/services/playlists', () => ({ openPlaylist: vi.fn() }));
vi.mock('$lib/app/services/contextMenu', () => ({ openContextMenu: vi.fn() }));
vi.mock('$lib/app/services/menus', () => ({ trackMenu: vi.fn(() => []), albumMenu: vi.fn(() => []), artistMenu: vi.fn(() => []), playlistMenu: vi.fn(() => []) }));
vi.mock('$lib/app/services/gate', () => ({ SIGN_IN_REQUIRED: 'Sign in', announceSignInRequired: vi.fn() }));

const empty: SearchResults = { songs: [], artists: [], albums: [], playlists: [] };
let target: HTMLDivElement, component: ReturnType<typeof mount>;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); resetSearchSession();
  vi.mocked(searchAll).mockResolvedValue({ ...empty, artists: [{ name: 'Artist', browseId: 'UCartist' }] });
  target = document.createElement('div'); document.body.append(target);
  component = mount(SearchView, { target, props: { compact: true } });
});
afterEach(async () => { await unmount(component); target.remove(); resetSearchSession(); vi.useRealTimers(); });
async function type(query: string) {
  const input = target.querySelector<HTMLInputElement>('[aria-label="Search music"]')!;
  input.value = query; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
  await vi.advanceTimersByTimeAsync(300); await tick();
}

it('supports typed category tokens and switches/removes them using properly labeled result buttons', async () => {
  await type('@artists Artist');
  expect(searchAll).toHaveBeenLastCalledWith('Artist', expect.anything(), 'artists');
  const filters = target.querySelector('[aria-label="Search filters"]')!;
  expect(Array.from(filters.querySelectorAll('button')).map(button => button.textContent)).toEqual(['All', 'Songs', 'Artists', 'Albums', 'Playlists']);
  const button = (label: string) => Array.from(filters.querySelectorAll('button')).find(button => button.textContent === label)!;
  expect(button('Artists').getAttribute('aria-pressed')).toBe('true');
  button('Albums').click(); await tick();
  expect(searchAll).toHaveBeenLastCalledWith('Artist', expect.anything(), 'albums');
  expect(target.querySelector<HTMLInputElement>('input')!.value).toBe('@albums Artist');
  button('All').click(); await tick();
  expect(searchAll).toHaveBeenLastCalledWith('Artist', expect.anything(), 'all');
  expect(target.querySelector<HTMLInputElement>('input')!.value).toBe('Artist');
});

it('does not search for an empty category token and retains pasted-link previews', async () => {
  await type('@songs'); expect(searchAll).not.toHaveBeenCalled();
  expect(target.querySelector('[aria-label="Search filters"]')).not.toBeNull();
  vi.mocked(resolveParsedLink).mockResolvedValue({ ...empty, songs: [{ videoId: 'video', title: 'Linked song', artists: [], thumbnails: [] }] });
  await type('https://youtu.be/video');
  expect(resolveParsedLink).toHaveBeenCalledWith({ kind: 'track', videoId: 'video' });
  expect(searchAll).not.toHaveBeenCalled();
  expect(target.textContent).toContain('Pasted link');
  expect(target.querySelector('[aria-label="Search filters"]')).toBeNull();
});

it('ignores an earlier response when the filter changes mid-search', async () => {
  let resolve!: (value: SearchResults) => void;
  vi.mocked(searchAll).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await type('Artist');
  const artists = Array.from(target.querySelectorAll('[aria-label="Search filters"] button')).find(button => button.textContent === 'Artists') as HTMLButtonElement;
  artists.click(); await tick();
  resolve({ ...empty, songs: [{ videoId: 'old', title: 'Outdated result', artists: [], thumbnails: [] }] });
  await tick(); await tick();
  expect(target.textContent).toContain('Artist');
  expect(target.textContent).not.toContain('Outdated result');
});
