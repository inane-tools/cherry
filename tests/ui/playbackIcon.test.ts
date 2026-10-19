import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import PlaybackIcon from '../../src/lib/ui/components/PlaybackIcon.svelte';

let target: HTMLDivElement;
let component: ReturnType<typeof mount>;
const state = new SvelteMap<string, boolean>();
beforeEach(() => {
  vi.useFakeTimers();
  state.set('loading', false);
  target = document.createElement('div');
  document.body.appendChild(target);
  component = mount(PlaybackIcon, { target, props: {
    get loading() { return state.get('loading')!; }, playing: true,
  } });
});
afterEach(async () => { await unmount(component); target.remove(); vi.useRealTimers(); });

it('delays the spinner, hides it immediately on recovery and starts a fresh delay next time', async () => {
  state.set('loading', true); await tick();
  await vi.advanceTimersByTimeAsync(299); await tick();
  expect(target.querySelector('.animate-spin')).toBeNull();
  await vi.advanceTimersByTimeAsync(1); await tick();
  expect(target.querySelector('.animate-spin')).not.toBeNull();
  state.set('loading', false); await tick();
  expect(target.querySelector('.animate-spin')).toBeNull();
  expect(target.querySelector('.ph-pause')).not.toBeNull();
  state.set('loading', true); await tick();
  await vi.advanceTimersByTimeAsync(299); await tick();
  expect(target.querySelector('.animate-spin')).toBeNull();
});

it('does not flash the spinner when playback recovers before the delay', async () => {
  state.set('loading', true); await tick();
  await vi.advanceTimersByTimeAsync(100);
  state.set('loading', false); await tick();
  await vi.advanceTimersByTimeAsync(1000); await tick();
  expect(target.querySelector('.animate-spin')).toBeNull();
});
