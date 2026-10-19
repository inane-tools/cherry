import { afterEach, expect, it } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import EntityHeader from '../../src/lib/ui/components/EntityHeader.svelte';

let component: ReturnType<typeof mount> | undefined;
afterEach(async () => { if (component) await unmount(component); document.body.innerHTML = ''; });

it('keeps the loading header in place and reveals cover and banner only after their images load', async () => {
  const target = document.createElement('div'); document.body.append(target);
  const state = new SvelteMap([['loading', true]]);
  component = mount(EntityHeader, { target, props: {
    thumbnails: [{ url: 'https://example.com/cover.jpg', width: 512, height: 512 }],
    banner: [{ url: 'https://example.com/banner.jpg', width: 1440, height: 500 }],
    get loading() { return state.get('loading')!; },
  } });
  await tick();
  const cover = target.querySelector('[data-entity-cover] img')!;
  const banner = target.querySelector('.entity-backdrop img')!;
  expect(target.querySelector('header')?.getAttribute('aria-busy')).toBe('true');
  expect(target.querySelector('[aria-label="Loading details"]')).not.toBeNull();
  expect(cover.classList.contains('opacity-0')).toBe(true);
  expect(banner.classList.contains('opacity-0')).toBe(true);
  state.set('loading', false); await tick();
  expect(target.querySelector('[aria-label="Loading details"]')).toBeNull();
  expect(cover.classList.contains('opacity-0')).toBe(true);
  cover.dispatchEvent(new Event('load')); await tick();
  expect(cover.classList.contains('opacity-100')).toBe(true);
  expect(banner.classList.contains('opacity-0')).toBe(true);
  banner.dispatchEvent(new Event('load')); await tick();
  expect(banner.classList.contains('opacity-60')).toBe(true);
  expect(target.querySelector('[data-entity-cover]')).not.toBeNull();
});
