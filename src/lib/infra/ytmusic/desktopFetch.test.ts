import { afterEach, expect, it, vi } from 'vitest';
vi.mock('$lib/desktop/core', () => ({ invoke: vi.fn() }));
import { invoke } from '$lib/desktop/core';
import { innertubeFetch } from './desktopFetch';
afterEach(() => { delete window.cherryDesktop; });

it('keeps the underlying network diagnosis instead of the Electron IPC wrapper', async () => {
  window.cherryDesktop = { invoke: vi.fn(), subscribe: vi.fn() };
  vi.mocked(invoke).mockRejectedValueOnce(new Error("Error invoking remote method 'desktop:invoke': Error: Network request to youtube.com failed: DNS could not resolve the server (ENOTFOUND)"));
  await expect(innertubeFetch()!('https://youtube.com/test')).rejects.toThrow('Network request to youtube.com failed: DNS could not resolve the server (ENOTFOUND)');
});
