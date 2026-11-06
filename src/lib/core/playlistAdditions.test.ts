import { expect, it } from 'vitest';
import { PlaylistAdditions } from './playlistAdditions';
import type { Track } from './models';
const song = (videoId: string, playlistEntryId?: string): Track => ({ videoId, title: videoId, artists: [], thumbnails: [], playlistEntryId });
it('keeps the submitted order of bulk additions, including interleaved duplicate songs', () => {
  const edits = new PlaylistAdditions();
  edits.record('list', [song('a'), song('b'), song('a')]);
  expect(edits.reconcile('list', [], true).map(track => track.videoId)).toEqual(['a', 'b', 'a']);
});
it('retains the newest addition through repeated stale reads and acknowledges only complete reads', () => {
  const edits = new PlaylistAdditions();
  edits.record('list', [song('a')]);
  expect(edits.reconcile('list', [], true).map(t => t.videoId)).toEqual(['a']);
  edits.record('list', [song('b')]);
  expect(edits.reconcile('list', [song('a')], true).map(t => t.videoId)).toEqual(['a', 'b']);
  edits.reconcile('list', [song('a'), song('b')], false);
  expect(edits.reconcile('list', [song('a')], true).map(t => t.videoId)).toEqual(['a', 'b']);
  const confirmed = [song('a', 'a-entry'), song('b', 'b-entry')];
  expect(edits.reconcile('list', confirmed, true)).toBe(confirmed);
});
it('preserves intentional duplicate occurrences without copying entry IDs from the source playlist', () => {
  const edits = new PlaylistAdditions();
  const original = song('same', 'original');
  edits.record('list', [song('same', 'different-source')], [original]);
  const result = edits.reconcile('list', [original], true);
  expect(result).toHaveLength(2); expect(result[1].playlistEntryId).toBeUndefined();
  edits.record('list', [song('same')], result);
  expect(edits.reconcile('list', [original], true)).toHaveLength(3);
  const confirmed = [original, song('same', 'new-1'), song('same', 'new-2')];
  expect(edits.reconcile('list', confirmed, true)).toEqual(confirmed);
});
it('keeps likes idempotent, removals respected and channels isolated', () => {
  const edits = new PlaylistAdditions();
  edits.record('brand-a:liked', [song('same'), song('same')], [], true);
  expect(edits.reconcile('brand-a:liked', [], true)).toHaveLength(1);
  expect(edits.reconcile('brand-b:liked', [], true)).toEqual([]);
  edits.remove('brand-a:liked', 'same');
  expect(edits.reconcile('brand-a:liked', [], true)).toEqual([]);
});
