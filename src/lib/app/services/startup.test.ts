import { afterEach, expect, it, vi } from 'vitest';
import { waitForStartup } from './startup';
afterEach(() => vi.useRealTimers());
it('reveals immediately when initial data is ready and clears its timer', async () => {
  vi.useFakeTimers();
  await waitForStartup(Promise.resolve(), 2000);
  expect(vi.getTimerCount()).toBe(0);
});
it('does not block the app on a stalled request', async () => {
  vi.useFakeTimers();
  const revealed = vi.fn();
  const pending = waitForStartup(new Promise(() => {}), 2000).then(revealed);
  await vi.advanceTimersByTimeAsync(1999);
  expect(revealed).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(revealed).toHaveBeenCalledOnce();
});
it('allows startup to continue after failed initial requests', async () => {
  await expect(waitForStartup(Promise.reject(new Error('Offline')), 2000)).resolves.toBeUndefined();
});
