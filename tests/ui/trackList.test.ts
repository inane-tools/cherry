import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
vi.mock('$lib/app/services/player', async () => ({ playerStore: (await import('svelte/store')).writable({ track: null, status: 'paused' }) }));
vi.mock('$lib/app/services/catalog', () => ({ openArtist: vi.fn() }));
vi.mock('$lib/app/services/menus', () => ({ trackMenu: vi.fn(() => []) }));
import TrackList from '../../src/lib/ui/components/TrackList.svelte';
import { trackMenu } from '../../src/lib/app/services/menus';
let viewport: HTMLDivElement;
let component: ReturnType<typeof mount>;
let frames: FrameRequestCallback[];
beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.push(fn); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  viewport = document.createElement('div'); viewport.style.overflowY = 'auto';
  Object.defineProperty(viewport, 'clientHeight', { value: 400 });
  document.body.append(viewport);
});
afterEach(async () => { await unmount(component); viewport.remove(); vi.unstubAllGlobals(); });
it('mounts only visible rows of a large playlist and preserves original play/removal indexes', async () => {
  const tracks = Array.from({ length: 10000 }, (_, index) => ({ videoId: `song-${index}`, title: `Track ${index}`, artists: [], thumbnails: [] }));
  // Duplicates remain separate source occurrences.
  tracks[500] = { ...tracks[0] };
  const playlist = { browseId: 'VLowned', title: 'Owned', thumbnails: [] };
  const onPlay = vi.fn();
  component = mount(TrackList, { target: viewport, props: { tracks, playlist, onPlay, currentIndex: 500 } });
  await tick();
  expect(viewport.querySelectorAll('[data-track-index]').length).toBeLessThan(30);
  const list = viewport.querySelector<HTMLElement>('[data-track-list]')!;
  list.getBoundingClientRect = () => ({ top: 100 - viewport.scrollTop } as DOMRect);
  viewport.scrollTop = 27100; viewport.dispatchEvent(new Event('scroll'));
  frames.splice(0).forEach(frame => frame(0)); await tick();
  const row = viewport.querySelector<HTMLElement>('[data-track-index="500"] > [role="button"]')!;
  row.click(); expect(onPlay).toHaveBeenCalledWith(tracks[500], 500);
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  expect(trackMenu).toHaveBeenLastCalledWith(tracks[500], tracks, 500, playlist);
  expect(viewport.querySelectorAll('[data-track-index]').length).toBeLessThan(35);
});
it('can keyboard-focus the last song without mounting the entire collection', async () => {
  const tracks = Array.from({ length: 1000 }, (_, index) => ({ videoId: `song-${index}`, title: `Track ${index}`, artists: [], thumbnails: [] }));
  component = mount(TrackList, { target: viewport, props: { tracks, onPlay: vi.fn() } }); await tick();
  const first = viewport.querySelector<HTMLElement>('[data-track-index="0"] > [role="button"]')!;
  first.focus(); first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  await tick(); await tick();
  expect(document.activeElement?.closest('[data-track-index]')?.getAttribute('data-track-index')).toBe('999');
  expect(viewport.querySelectorAll('[data-track-index]').length).toBeLessThan(35);
});
