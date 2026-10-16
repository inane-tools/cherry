import { afterEach, expect, it, vi } from 'vitest';
import { parseLrc, lookupLyrics } from './lyricsTiming';
afterEach(() => vi.unstubAllGlobals());
it('reads LRC timestamps, repeats, offsets and instrumental blank lines', () => {
  const lyrics = parseLrc('[offset:100]\n[00:01.20][00:05.00]Repeated\n[00:03.00]\n[00:99.0]Invalid');
  expect(lyrics).toMatchObject({ synced: true, source: 'LRCLIB', lines: [
    { text: 'Repeated', startSeconds: 1.3, endSeconds: 3.1 },
    { text: '', startSeconds: 3.1, endSeconds: 5.1 },
    { text: 'Repeated', startSeconds: 5.1 },
  ] });
  expect(parseLrc('Plain lyrics')).toBeNull();
});
it('rejects other song versions and sends only public metadata, without cookies', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ trackName: 'Song', artistName: 'Artist', duration: 203, syncedLyrics: '[00:01]First' }) });
  vi.stubGlobal('fetch', fetch);
  const track = { videoId: 'id', title: 'Song', artists: [{ name: 'Artist' }], thumbnails: [] };
  expect(await lookupLyrics(track, 200)).toBeNull();
  expect(await lookupLyrics(track, 203)).toMatchObject({ synced: true, source: 'LRCLIB' });
  expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining('track_name=Song'), expect.objectContaining({ credentials: 'omit' }));
});
it('uses LRCLIB plain lyrics when that source has no valid timing', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ trackName: 'Song', artistName: 'Artist', duration: 200, syncedLyrics: null, plainLyrics: 'First\nSecond' }) }));
  expect(await lookupLyrics({ videoId: 'id', title: 'Song', artists: [{ name: 'Artist' }], thumbnails: [] }, 200))
    .toEqual({ synced: false, source: 'LRCLIB', lines: [{ text: 'First' }, { text: 'Second' }] });
});
