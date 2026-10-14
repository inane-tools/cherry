import { expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
vi.mock('./overlays', () => ({ openSearch: vi.fn(), openSettings: vi.fn() }));
import { go, back, forward, pageStore } from './navigation';
import { playerExpanded } from './layout';

it('opens Explore as a page, collapses the player, and supports Back/Forward', () => {
  playerExpanded.set(true);
  go('explore');
  expect(get(pageStore)).toEqual({ view: 'explore' });
  expect(get(playerExpanded)).toBe(false);
  back();
  expect(get(pageStore)).toEqual({ view: 'home' });
  forward();
  expect(get(pageStore)).toEqual({ view: 'explore' });
});
