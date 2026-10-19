import { beforeEach, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Track } from './models';
import { playingTrackIndex } from './playingTrackIndex';
import { clearQueue, currentItem, cutQueueTo, queueItems, setQueue, setShuffle, step } from '$lib/app/services/queue';

const song = (videoId: string): Track => ({ videoId, title: videoId, artists: [], thumbnails: [] });
beforeEach(() => { clearQueue(); setShuffle(false); });

it('highlights only the selected duplicate, then follows next and previous', () => {
  const tracks = [song('same'), song('other'), song('same')];
  setQueue(tracks, 2);
  expect(playingTrackIndex(tracks, get(currentItem))).toBe(2);
  step(-1);
  expect(playingTrackIndex(tracks, get(currentItem))).toBe(1);
  step(-1);
  expect(playingTrackIndex(tracks, get(currentItem))).toBe(0);
});

it('retains the selected occurrence with shuffle and after cutting the queue', () => {
  const tracks = [song('same'), song('other'), song('same')];
  setShuffle(true);
  setQueue(tracks, 2);
  expect(playingTrackIndex(tracks, get(currentItem))).toBe(2);
  const firstCopy = get(queueItems)[0];
  cutQueueTo(firstCopy.queueId);
  expect(playingTrackIndex(tracks, get(currentItem))).toBe(0);
});

it('retains the occurrence after playlist or queue data is reloaded', () => {
  const tracks = [song('same'), song('other'), song('same')];
  setQueue(tracks, 2);
  const restored = JSON.parse(JSON.stringify(get(currentItem)));
  expect(playingTrackIndex(tracks.map(track => ({ ...track })), restored)).toBe(2);
});

it('handles repeated references, removed entries, unrelated songs and an empty queue', () => {
  const track = song('same');
  setQueue([track, track], 1);
  expect(playingTrackIndex([track, track], get(currentItem))).toBe(1);
  expect(playingTrackIndex([track], get(currentItem))).toBe(0);
  expect(playingTrackIndex([song('other')], get(currentItem))).toBe(-1);
  expect(playingTrackIndex([track], null)).toBe(-1);
});

it('does not highlight another copy after the playing playlist entry is removed', () => {
  const first = { ...song('same'), playlistEntryId: 'entry-a' };
  const second = { ...song('same'), playlistEntryId: 'entry-b' };
  setQueue([first, second], 1);
  expect(playingTrackIndex([{ ...first }, { ...second }], get(currentItem))).toBe(1);
  expect(playingTrackIndex([first], get(currentItem))).toBe(-1);
});
