import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('./platform', () => ({ isDesktop: () => true, invokeStrict: vi.fn(), invokeSafe: vi.fn() }));
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({
  clearStreamCache: vi.fn(), getInnertube: vi.fn(async () => ({})), resetInnertubeClient: vi.fn(),
}));
vi.mock('$lib/infra/storage/cache', () => ({ cacheClear: vi.fn() }));
vi.mock('./queue', () => ({ clearQueue: vi.fn() }));
vi.mock('./queuePersistence', () => ({ clearStoredQueue: vi.fn() }));

const { invokeStrict } = await import('./platform');
const { clearQueue } = await import('./queue');
const { authStore, authStatus, restoreAuth, signOut, signInWithCookie } = await import('./auth');
const session = { kind: 'cookie' as const, cookie: `SID=${'x'.repeat(50)}`, savedAt: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  authStore.set(null);
  authStatus.set('checking');
});

describe('sign out', () => {
  it('keeps a restored session when keychain deletion fails', async () => {
    vi.mocked(invokeStrict).mockResolvedValueOnce(session).mockRejectedValueOnce('Keychain is locked');
    await restoreAuth();
    await expect(signOut()).rejects.toBe('Keychain is locked');
    expect(get(authStore)).toEqual(session);
    expect(get(authStatus)).toBe('signed-in');
    expect(clearQueue).not.toHaveBeenCalled();
  });

  it('clears the live session only after its saved copy is deleted', async () => {
    let finish!: () => void;
    vi.mocked(invokeStrict).mockResolvedValueOnce(session);
    await restoreAuth();
    vi.mocked(invokeStrict).mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    const done = signOut();
    expect(get(authStore)).toEqual(session);
    finish();
    await done;
    expect(invokeStrict).toHaveBeenLastCalledWith('auth_clear');
    expect(get(authStore)).toBeNull();
    expect(get(authStatus)).toBe('signed-out');
    expect(clearQueue).toHaveBeenCalledOnce();
  });
});

it('keeps the temporary-session warning returned by the desktop auth store', async () => {
  vi.mocked(invokeStrict).mockResolvedValueOnce({ ...session, persistence: 'memory' });
  await signInWithCookie(session.cookie);
  expect(get(authStore)?.persistence).toBe('memory');
  expect(get(authStatus)).toBe('signed-in');
});
