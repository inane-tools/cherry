import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import { get } from 'svelte/store';
vi.mock('$lib/app/services/player', async () => { const { writable } = await import('svelte/store'); return { playerStore: writable({ status: 'paused' }), playQueueItem: vi.fn() }; });
vi.mock('$lib/app/services/catalog', () => ({ openArtist: vi.fn() }));
import QueueList from '../../src/lib/ui/chrome/QueueList.svelte';
import { setQueue, upNextQueue } from '../../src/lib/app/services/queue';
let viewport: HTMLDivElement;
let component: ReturnType<typeof mount>;
let frames: FrameRequestCallback[];
beforeEach(() => {
  frames = [];
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.push(fn); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  viewport = document.createElement('div'); viewport.style.overflowY = 'auto';
  Object.defineProperty(viewport, 'clientHeight', { value: 400 }); document.body.appendChild(viewport);
});
afterEach(async () => { if (component) await unmount(component); viewport.remove(); vi.unstubAllGlobals(); });
async function scroll(top: number) {
  const list = viewport.querySelector('[data-queue-list]') as HTMLElement;
  list.getBoundingClientRect = () => ({ top: 100 - viewport.scrollTop } as DOMRect);
  viewport.scrollTop = top; viewport.dispatchEvent(new Event('scroll'));
  const pending = frames.splice(0); pending.forEach(fn => fn(0)); await tick();
}
function seed(count: number) {
  setQueue(Array.from({ length: count }, (_, index) => ({ videoId: `song-${index}`, title: `Track ${index}`, artists: [], thumbnails: [] })));
  component = mount(QueueList, { target: viewport });
}
it('opens a ten-thousand-track queue with a bounded number of DOM rows and scrolls to distant items', async () => {
  seed(10000); await tick();
  expect(viewport.querySelectorAll('[data-queue-row]').length).toBeLessThan(30);
  await scroll(25100);
  expect(viewport.textContent).toContain('Track 501');
  expect(viewport.querySelectorAll('[data-queue-row]').length).toBeLessThan(35);
  expect(viewport.querySelector('[data-queue-index="500"]')).not.toBeNull();
});
it('keeps the drag source mounted and reorders against full queue indexes after scrolling', async () => {
  seed(1000); await tick();
  const first = viewport.querySelector('[data-queue-index="0"]')!;
  first.dispatchEvent(new Event('dragstart', { bubbles: true })); await tick();
  await scroll(25100);
  expect(first.isConnected).toBe(true);
  const target = viewport.querySelector('[data-queue-index="500"]')!;
  target.getBoundingClientRect = () => ({ top: 0, height: 48 } as DOMRect);
  target.dispatchEvent(new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY: 1 })); await tick();
  target.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true })); await tick();
  const list = get(upNextQueue);
  const moved = list.findIndex(item => item.track.videoId === 'song-1');
  expect(list[moved + 1].track.videoId).toBe('song-501');
  expect(list).toHaveLength(999);
});

it('can keyboard-navigate to the end without mounting the whole queue', async () => {
  seed(1000); await tick();
  const first = viewport.querySelector('[data-queue-index="0"]') as HTMLElement;
  first.focus(); first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  await tick();
  await vi.waitFor(() => expect((document.activeElement as HTMLElement).dataset.queueIndex).toBe('998'));
  expect(viewport.querySelectorAll('[data-queue-row]').length).toBeLessThan(35);
});
