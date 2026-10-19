import { expect, it, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import ShelfHeading from '../../src/lib/ui/components/ShelfHeading.svelte';
import { openProfile, openBrowseCard } from '../../src/lib/app/services/browse';
vi.mock('$lib/app/services/browse', () => ({ openProfile: vi.fn(), openBrowseCard: vi.fn() }));

it('opens the owner profile from the avatar and uses a separate endpoint for the shelf title', async () => {
  const target = document.createElement('div'); document.body.appendChild(target);
  const profile = { browseId: 'UCowner', params: 'profile' };
  const thumbnails = [{ url: 'https://image.test/avatar' }];
  const component = mount(ShelfHeading, { target, props: { section: { title: 'Listen again', cards: [], songs: [],
    header: { subtitle: 'SAME', thumbnails, profile, more: { browseId: 'FEmusic_history', params: 'history' } } } } });
  try {
    await tick();
    const avatar = target.querySelector<HTMLButtonElement>('[aria-label="Open SAME profile"]')!;
    expect(avatar.querySelector('img')?.src).toBe('https://image.test/avatar');
    expect(target.textContent).not.toContain('SAME');
    avatar.click();
    expect(openProfile).toHaveBeenCalledExactlyOnceWith(profile, 'SAME', thumbnails);
    target.querySelector<HTMLButtonElement>('h2 button')!.click();
    expect(openBrowseCard).toHaveBeenCalledExactlyOnceWith('FEmusic_history', 'Listen again', [], undefined, 'history', undefined);
  } finally { await unmount(component); target.remove(); }
});

it.each([
  { title: 'Songs on repeat', subtitle: 'Private · Only visible to you', chip: 'Private', heading: 'Songs on repeat' },
  { title: 'Playlists', subtitle: 'Public', chip: 'Public', heading: 'Playlists' },
  { title: 'Public videos', subtitle: undefined, chip: 'Public', heading: 'Videos' },
])('puts the $chip chip above the profile shelf heading ($title)', async ({ title, subtitle, chip, heading: expectedHeading }) => {
  const target = document.createElement('div'); document.body.appendChild(target);
  const component = mount(ShelfHeading, { target, props: { profilePage: true, section: {
    title, cards: [], songs: [], header: { subtitle, thumbnails: [] },
  } } });
  try {
    await tick();
    const heading = target.querySelector('h2')!;
    expect(heading.textContent?.trim()).toBe(expectedHeading);
    expect(heading.previousElementSibling?.textContent).toBe(chip);
    expect(target.textContent).not.toContain('Only visible');
  } finally { await unmount(component); target.remove(); }
});
