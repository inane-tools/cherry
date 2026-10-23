import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import { writable } from 'svelte/store';
vi.mock('../../src/lib/app/services/updates', () => ({
  updateStore: writable({ environment: 'windows', initialized: true, phase: 'available', version: '2.0.1',
    notes: '## Fixed\n\n- **Playback**\n\n[Details](https://github.com/inane-tools/cherry/releases)', received: 0, total: 0, error: '' }),
  initializeUpdates: vi.fn(async () => {}), checkUpdates: vi.fn(), downloadUpdate: vi.fn(), installUpdate: vi.fn(),
}));
vi.mock('../../src/lib/desktop/opener', () => ({ openUrl: vi.fn(async () => {}) }));
import { updateStore } from '../../src/lib/app/services/updates';
import { openUrl } from '../../src/lib/desktop/opener';
import UpdateSettings from '../../src/lib/ui/components/UpdateSettings.svelte';
let target: HTMLDivElement;
let component: ReturnType<typeof mount>;
beforeEach(() => { target = document.createElement('div'); document.body.appendChild(target); component = mount(UpdateSettings, { target }); });
afterEach(async () => { await unmount(component); target.remove(); });

it('formats notes only when expanded, keeps them during download, and opens links externally', async () => {
  await tick();
  expect(target.querySelector('.release-notes')).toBeNull();
  const details = target.querySelector('details')!;
  details.open = true; details.dispatchEvent(new Event('toggle')); await tick();
  await vi.waitFor(() => expect(target.querySelector('.release-notes h2')?.textContent).toBe('Fixed'));
  expect(target.querySelector('li strong')?.textContent).toBe('Playback');
  updateStore.update(state => ({ ...state, phase: 'downloading', received: 50, total: 100 })); await tick();
  expect(details.isConnected).toBe(true);
  target.querySelector('a')!.click();
  expect(openUrl).toHaveBeenCalledWith('https://github.com/inane-tools/cherry/releases');
});
