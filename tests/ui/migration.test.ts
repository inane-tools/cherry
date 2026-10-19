import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
vi.mock('$lib/desktop/core', () => ({ invoke: vi.fn() }));
vi.mock('$lib/app/services/navigation', () => ({ go: vi.fn() }));
import { invoke } from '../../src/lib/desktop/core';
import { go } from '../../src/lib/app/services/navigation';
import AuthGate from '../../src/lib/ui/components/AuthGate.svelte';

let target: HTMLDivElement;
let component: ReturnType<typeof mount>;
const preview = { found: true, token: 'preview-token', source: 'fixture/cherry-settings.json', pins: 2, folders: 1, warnings: [], credentialsSupported: true, credentialsReady: true };
const button = (label: string) => [...target.querySelectorAll('button')].find(item => item.textContent?.includes(label))!;
async function accept() {
  const checkbox = target.querySelector('input')!;
  checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true })); await tick();
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('__APP_VERSION__', '2.0.0');
  vi.stubGlobal('cherryDesktop', { invoke: vi.fn(), subscribe: vi.fn() });
  vi.mocked(invoke).mockResolvedValue(preview);
  target = document.createElement('div'); document.body.appendChild(target);
  component = mount(AuthGate, { target });
});
afterEach(async () => { await unmount(component); target.remove(); vi.unstubAllGlobals(); });

it('gates both settings and migration behind acceptance, without scanning any files on launch', async () => {
  await tick();
  expect(button('Settings').disabled).toBe(true);
  expect(button('Migrate from 1.x').disabled).toBe(true);
  button('Migrate from 1.x').click();
  expect(invoke).not.toHaveBeenCalled();
  await accept();
  expect(button('Settings').disabled).toBe(false);
  expect(button('Migrate from 1.x').disabled).toBe(false);
  button('Settings').click(); expect(go).toHaveBeenCalledWith('settings');
  button('Migrate from 1.x').click(); await tick();
  await vi.waitFor(() => expect(target.textContent).toContain('Settings found'));
  expect(invoke).toHaveBeenCalledExactlyOnceWith('migration_inspect', { accepted: true, pick: false });
  expect(invoke).not.toHaveBeenCalledWith('migration_import', expect.anything());
});

it('previews before importing, blocks duplicate actions, and offers a restart after success', async () => {
  await accept(); button('Migrate from 1.x').click();
  await vi.waitFor(() => expect(button('Import data').disabled).toBe(false));
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  button('Import data').click(); await tick();
  expect(invoke).toHaveBeenLastCalledWith('migration_import', { accepted: true, token: preview.token, includeCredentials: true });
  expect(target.querySelector('input')!.disabled).toBe(true);
  expect(button('Settings').disabled).toBe(true);
  expect(button('Importing…').disabled).toBe(true);
  finish({ backup: 'fixture/backup', pins: 2, folders: 1 }); await tick(); await tick();
  await vi.waitFor(() => expect(target.textContent).toContain('Ready to restart'));
  expect(target.textContent).toContain('fixture/backup');
  expect(target.querySelector('input')!.disabled).toBe(true);
  button('Restart Cherry').click();
  expect(invoke).toHaveBeenLastCalledWith('app:relaunch');
});

it('allows a failed import to be inspected again, without letting its stale preview be retried', async () => {
  await accept(); button('Migrate from 1.x').click();
  await vi.waitFor(() => expect(button('Import data').disabled).toBe(false));
  vi.mocked(invoke).mockRejectedValueOnce(new Error('File changed. Inspect again.'));
  button('Import data').click();
  await vi.waitFor(() => expect(target.querySelector('[role=alert]')?.textContent).toContain('File changed'));
  expect(button('Import data').disabled).toBe(true);
  expect(target.querySelector('input')!.disabled).toBe(false);
  button('Find again').click();
  await vi.waitFor(() => expect(button('Import data').disabled).toBe(false));
});

it('allows importing preferences without carrying over accounts', async () => {
  await accept(); button('Migrate from 1.x').click();
  await vi.waitFor(() => expect(button('Import data').disabled).toBe(false));
  const inputs = target.querySelectorAll('input');
  const accounts = inputs[1]; accounts.checked = false;
  accounts.dispatchEvent(new Event('change', { bubbles: true })); await tick();
  vi.mocked(invoke).mockResolvedValueOnce({ backup: 'fixture/backup', pins: 2, folders: 1, credentials: { youtube: 'skipped', lastfm: 'skipped' } });
  button('Import data').click();
  expect(invoke).toHaveBeenLastCalledWith('migration_import', { accepted: true, token: preview.token, includeCredentials: false });
  await vi.waitFor(() => expect(target.textContent).toContain('Sign in with YouTube Music in Settings'));
});
