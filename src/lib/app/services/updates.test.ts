import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';

const mocks = vi.hoisted(() => ({ check: vi.fn(), invoke: vi.fn(), download: vi.fn(), install: vi.fn(), close: vi.fn(), relaunch: vi.fn(), toggle: vi.fn(), flush: vi.fn(), settings: vi.fn() }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: mocks.check }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: mocks.relaunch }));
vi.mock('./platform', () => ({ isTauri: () => true, invokeStrict: mocks.invoke, invokeSafe: vi.fn(), errorMessage: (e: unknown) => String(e) }));
vi.mock('./player', () => ({ playerStore: writable({ status: 'playing' }), toggle: mocks.toggle }));
vi.mock('./queuePersistence', () => ({ flushQueue: mocks.flush }));
vi.mock('$lib/infra/storage/settingsRepo', () => ({ flushSettings: mocks.settings }));

async function service() { return import('./updates'); }
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.invoke.mockResolvedValue('windows');
  mocks.check.mockResolvedValue({ version: '1.7.0', body: 'Changes', download: mocks.download, install: mocks.install, close: mocks.close });
  mocks.download.mockResolvedValue(undefined);
  mocks.install.mockResolvedValue(undefined);
});
describe('signed update flow', () => {
  it('coalesces overlapping checks and retains the download when ready', async () => {
    const s = await service();
    await Promise.all([s.checkUpdates(), s.checkUpdates()]);
    expect(mocks.check).toHaveBeenCalledTimes(1);
    await s.downloadUpdate();
    await s.checkUpdates();
    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(get(s.updateStore).phase).toBe('ready');
  });
  it('never reports a failed check as up to date and allows retry', async () => {
    const s = await service();
    mocks.check.mockRejectedValueOnce('offline');
    await s.checkUpdates();
    expect(get(s.updateStore)).toMatchObject({ phase: 'error', error: 'offline' });
    mocks.check.mockResolvedValueOnce(null);
    await s.checkUpdates();
    expect(get(s.updateStore).phase).toBe('current');
  });
  it('does not try to self-update Flatpak or development builds', async () => {
    const s = await service();
    mocks.invoke.mockResolvedValue('flatpak');
    await s.checkUpdates();
    expect(mocks.check).not.toHaveBeenCalled();
  });
  it('reports byte progress, retries failed downloads, and requires download before install', async () => {
    const s = await service();
    await s.checkUpdates();
    await s.installUpdate();
    expect(mocks.install).not.toHaveBeenCalled();
    mocks.download.mockRejectedValueOnce('signature rejected');
    await s.downloadUpdate();
    expect(get(s.updateStore).phase).toBe('error');
    mocks.download.mockImplementationOnce(async callback => {
      callback({ event: 'Started', data: { contentLength: 100 } });
      callback({ event: 'Progress', data: { chunkLength: 60 } });
      callback({ event: 'Progress', data: { chunkLength: 40 } });
    });
    await s.downloadUpdate();
    expect(get(s.updateStore)).toMatchObject({ phase: 'ready', received: 100, total: 100, error: '' });
    await s.installUpdate();
    expect(mocks.toggle).toHaveBeenCalledOnce();
    expect(mocks.flush).toHaveBeenCalledOnce();
    expect(mocks.settings).toHaveBeenCalledOnce();
    expect(mocks.install).toHaveBeenCalledOnce();
    expect(mocks.relaunch).toHaveBeenCalledOnce();
    expect(mocks.flush.mock.invocationCallOrder[0]).toBeLessThan(mocks.install.mock.invocationCallOrder[0]);
  });
  it('keeps a downloaded update available after installation fails', async () => {
    const s = await service();
    await s.checkUpdates(); await s.downloadUpdate();
    mocks.install.mockRejectedValueOnce('permission denied');
    await s.installUpdate();
    expect(get(s.updateStore)).toMatchObject({ phase: 'ready', error: 'permission denied' });
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });
});
