import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { pageScroll } from './pageScroll';
import { back, forward, go, openPage, pageStore } from '$lib/app/services/navigation';
import { clearPageVisitCache } from '$lib/app/services/pageVisit';

const cleanups: (() => void)[] = [];
let frames: Map<number, FrameRequestCallback>;
let observers: (() => void)[];
beforeEach(() => {
  vi.useFakeTimers(); frames = new Map(); observers = [];
  let frame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frame, callback); return frame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { observers.push(callback); } observe() {} disconnect() {} });
  clearPageVisitCache(); go('home');
});
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup()); document.body.replaceChildren();
  vi.useRealTimers(); vi.unstubAllGlobals();
});
function fixture() {
  const main = document.createElement('main'); document.body.append(main);
  const content = document.createElement('div'); main.append(content);
  const carousel = document.createElement('div'); carousel.dataset.pageScrollKey = 'shelf'; content.append(carousel);
  const filters = document.createElement('div'); filters.dataset.pageScrollKey = 'home-filters'; content.append(filters);
  const action = pageScroll(main); cleanups.push(() => action.destroy());
  return { main, carousel, filters };
}
const subpage = (id = 'one') => openPage({ view: 'browse', entity: { browseId: `FE${id}`, title: id } });

it('restores Home and Explore vertical and horizontal positions only on Back/Forward', async () => {
  const f = fixture();
  f.main.scrollTop = 500; f.carousel.scrollLeft = 340; f.filters.scrollLeft = 120;
  go('explore'); expect(f.main.scrollTop).toBe(0);
  f.main.scrollTop = 900; f.carousel.scrollLeft = 680;
  subpage(); expect(f.main.scrollTop).toBe(0);
  back(); await tick();
  expect(f.main.scrollTop).toBe(900); expect(f.carousel.scrollLeft).toBe(680);
  back(); await tick();
  expect(f.main.scrollTop).toBe(500); expect(f.carousel.scrollLeft).toBe(340); expect(f.filters.scrollLeft).toBe(120);
  forward(); await tick(); expect(f.main.scrollTop).toBe(900);
  go('home'); expect(f.main.scrollTop).toBe(0);
});

it('distinguishes multiple visits to Home and does not reset on metadata/same-page updates', async () => {
  const f = fixture(); f.main.scrollTop = 300;
  pageStore.set({ view: 'home' }); expect(f.main.scrollTop).toBe(300);
  subpage('first'); go('home'); f.main.scrollTop = 700; subpage('second');
  back(); await tick(); expect(f.main.scrollTop).toBe(700);
  back(); await tick(); expect(f.main.scrollTop).toBe(0);
  back(); await tick(); expect(f.main.scrollTop).toBe(300);
});

it('waits for content height, but stops restoring as soon as the user scrolls', async () => {
  const f = fixture(); let top = 0, maximum = 1000;
  Object.defineProperty(f.main, 'scrollTop', { get: () => top, set: value => { top = Math.min(value, maximum); } });
  f.main.scrollTop = 800; subpage(); maximum = 100;
  back(); await tick(); expect(f.main.scrollTop).toBe(100);
  maximum = 1000; observers.forEach(callback => callback());
  const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0));
  expect(f.main.scrollTop).toBe(800);
  f.main.dispatchEvent(new Event('wheel')); f.main.scrollTop = 250;
  observers.forEach(callback => callback());
  const later = [...frames.values()]; frames.clear(); later.forEach(callback => callback(0));
  expect(f.main.scrollTop).toBe(250);
  clearPageVisitCache(); subpage('after-signout'); back(); await tick();
  expect(f.main.scrollTop).toBe(0);
});
