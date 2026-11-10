import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AccountButton from '../../src/lib/ui/components/AccountButton.svelte';
import { updateStore } from '../../src/lib/app/services/updates';

vi.hoisted(() => { Object.assign(globalThis, { __APP_VERSION__: '2.3.0' }); });
vi.mock('$lib/app/services/navigation', () => ({ go: vi.fn() }));
vi.mock('$lib/app/services/auth', async () => ({ authStore: (await import('svelte/store')).writable({ accountLabel: 'Listener' }) }));
vi.mock('$lib/app/services/playlists', async () => {
  const { writable } = await import('svelte/store');
  return { homeSectionsStore: writable([]), playlistStore: writable([{}, {}, {}]) };
});
vi.mock('$lib/desktop/window', () => ({ getCurrentWindow: () => ({ close: vi.fn() }) }));

let target: HTMLElement;
let component: ReturnType<typeof mount>;
const base = { environment: 'development', initialized: true, notes: '', received: 0, total: 0, error: '' } as const;

beforeEach(() => { target = document.createElement('div'); document.body.append(target); });
afterEach(() => { unmount(component); target.remove(); document.querySelectorAll('[role=menu]').forEach(menu => menu.remove()); });

function open(expanded: boolean) {
  component = mount(AccountButton, { target, props: { expanded } });
  flushSync();
  const button = target.querySelector<HTMLButtonElement>('button[aria-haspopup=menu]')!;
  return button;
}
const menuLabels = () => [...document.querySelectorAll('[role=menu] [role=menuitem]')].map(item => item.textContent?.trim());

it('shows no update badge or menu item while up to date', () => {
  updateStore.set({ ...base, phase: 'idle', version: '' });
  const button = open(false);
  expect(button.getAttribute('aria-label')).toBe('Main menu');
  expect(button.querySelector('.ph-arrow-up')).toBeNull();
  button.click(); flushSync();
  expect(menuLabels()).toEqual(['Settings', 'Your profile', 'Quit Cherry']);
});

it.each([false, true])('badges the avatar and leads the menu with an available update (expanded: %s)', (expanded) => {
  updateStore.set({ ...base, phase: 'available', version: '2.3.1' });
  const button = open(expanded);
  expect(button.getAttribute('aria-label')).toBe('Main menu, Update available · v2.3.1');
  expect(button.querySelector('.ring-amber-400')).not.toBeNull();
  expect(button.querySelector('.ph-arrow-up')).not.toBeNull();
  button.click(); flushSync();
  expect(menuLabels()[0]).toBe('Update available · v2.3.1');
});

it('shows the account name in the expanded row without a playlist count', () => {
  updateStore.set({ ...base, phase: 'idle', version: '' });
  const button = open(true);
  expect(button.textContent).toContain('Listener');
  expect(button.textContent).not.toContain('playlists');
});
