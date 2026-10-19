import { expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
vi.mock('./overlays', () => ({ openSearch: vi.fn(), openSettings: vi.fn() }));
import { go, back, forward, pageStore } from './navigation';
import { playerExpanded } from './layout';
import { pageVisitStore } from './pageVisit';

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

it('keeps separate visit identities and marks history traversal for scroll restoration', () => {
  go('home'); const home = get(pageVisitStore).token;
  go('explore'); const explore = get(pageVisitStore).token;
  expect(explore).not.toBe(home);
  expect(get(pageVisitStore).restore).toBe(false);
  back(); expect(get(pageVisitStore)).toEqual({ token: home, restore: true });
  forward(); expect(get(pageVisitStore)).toEqual({ token: explore, restore: true });
  go('home'); expect(get(pageVisitStore).token).not.toBe(home);
  expect(get(pageVisitStore).restore).toBe(false);
});
