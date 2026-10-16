import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./platform', () => ({ isDesktop: () => true, invokeStrict: vi.fn(), invokeSafe: vi.fn() }));
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({ resetInnertubeClient: vi.fn() }));
vi.mock('$lib/infra/storage/settingsRepo', () => ({ flushSettings: vi.fn(async () => {}) }));
import { invokeSafe, invokeStrict } from './platform';
import { clearAllData, clearCache, formatCacheSize } from './maintenance';

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); });

it('cache-only preserves preferences and queue and reports partial native failures', async () => {
  localStorage.setItem('cherry.queue', 'saved queue');
  localStorage.setItem('cherry.settings', 'preferences');
  localStorage.setItem('cherry.cache.playlist', 'cached');
  vi.mocked(invokeStrict).mockResolvedValue({ removed: ['App HTTP cache'], locked: ['Login HTTP cache'] });
  const result = await clearCache();
  expect(localStorage.getItem('cherry.queue')).toBe('saved queue');
  expect(localStorage.getItem('cherry.settings')).toBe('preferences');
  expect(localStorage.getItem('cherry.cache.playlist')).toBeNull();
  expect(result.locked).toEqual(['Login HTTP cache']);
  expect(invokeStrict).toHaveBeenCalledWith('clear_cache');
});

it('full reset removes renderer storage and retains individual cleanup failures', async () => {
  localStorage.setItem('cherry.queue', 'saved');
  sessionStorage.setItem('private', 'saved');
  vi.mocked(invokeStrict).mockResolvedValue(['settings', 'locked:shortcut artwork']);
  expect(await clearAllData()).toEqual({ removed: ['settings'], locked: ['shortcut artwork'] });
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

it('formats profile bytes and does not show invalid measurements as a real size', async () => {
  vi.mocked(invokeSafe).mockResolvedValue(1572864);
  expect(await formatCacheSize()).toBe('1.5 MB');
  vi.mocked(invokeSafe).mockResolvedValue(-1);
  expect(await formatCacheSize()).toBe('unknown');
});
