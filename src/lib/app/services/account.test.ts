import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { AccountProfile, AuthSession } from '$lib/core/models';

vi.mock('./auth', async () => {
  const { writable } = await import('svelte/store');
  return { authStore: writable<AuthSession | null>(null) };
});
vi.mock('./settings', async () => {
  const { writable } = await import('svelte/store');
  return { settingsStore: writable({ channelPageId: 'a' }), updateSettings: vi.fn(async () => undefined) };
});
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({
  getChannels: vi.fn(), pickPrimaryChannel: vi.fn(async () => null),
  getAccountProfile: vi.fn(), setActiveChannel: vi.fn(),
}));

const { authStore } = await import('./auth');
const api = await import('$lib/infra/ytmusic/InnertubeClient');
const service = await import('./account');
const session: AuthSession = { kind: 'cookie', cookie: 'SID=restored', savedAt: 0 };
const profile: AccountProfile = { name: 'Channel A', pageId: 'a', isChannel: true };

beforeEach(() => {
  vi.clearAllMocks();
  authStore.set(null);
  authStore.set(session);
  vi.mocked(api.getChannels).mockResolvedValue([profile]);
});

describe('channel lifecycle', () => {
  it('clears the channel when a startup session signs out', async () => {
    await service.initChannel();
    expect(get(service.activeChannelStore)).toEqual(profile);
    authStore.set(null);
    expect(get(service.activeChannelStore)).toBeNull();
    expect(get(service.channelsStore)).toEqual([]);
    expect(api.setActiveChannel).toHaveBeenLastCalledWith('');
  });

  it('coalesces simultaneous initialization requests', async () => {
    await Promise.all([service.initChannel(), service.initChannel()]);
    expect(api.getChannels).toHaveBeenCalledOnce();
  });

  it('ignores channel discovery that completes after sign-out', async () => {
    let finish!: (profiles: AccountProfile[]) => void;
    vi.mocked(api.getChannels).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const pending = service.initChannel();
    authStore.set(null);
    finish([profile]);
    expect(await pending).toBeNull();
    expect(get(service.activeChannelStore)).toBeNull();
    expect(get(service.channelsStore)).toEqual([]);
  });

  it('does not let an older forced discovery replace the newer channel', async () => {
    let finish!: (profiles: AccountProfile[]) => void;
    vi.mocked(api.getChannels).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const old = service.initChannel();
    const newer = { ...profile, name: 'Updated channel' };
    vi.mocked(api.getChannels).mockResolvedValueOnce([newer]);
    await service.initChannel(true);
    finish([profile]);
    await old;
    expect(get(service.activeChannelStore)).toEqual(newer);
    expect(get(service.channelsStore)).toEqual([newer]);
  });
});
