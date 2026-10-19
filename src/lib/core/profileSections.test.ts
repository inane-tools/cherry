import { expect, it } from 'vitest';
import { appendProfileSection, isPrivateProfileSection, isPersonalMix, profileSectionTitle, repeatArtists } from './profileSections';
import type { HomeSection } from '$lib/infra/ytmusic/rawHome';

const section = (title: string): HomeSection => ({ title, cards: [], songs: [] });

it('appends continuation items without duplicating previews or replacing the shelf header', () => {
  const card = { browseId: 'VLfirst', title: 'First', thumbnails: [] };
  const song = { videoId: 'song', title: 'Song', thumbnails: [] };
  const base = { ...section('Public playlists'), cards: [card], songs: [song], order: ['s:song', 'c:VLfirst'], header: { thumbnails: [], subtitle: 'Public' } };
  const result = appendProfileSection(base, [{ ...section(''), cards: [card, { ...card, browseId: 'VLsecond' }], songs: [song], order: ['c:VLfirst', 'c:VLsecond', 's:song'] }]);
  expect(result.cards.map(item => item.browseId)).toEqual(['VLfirst', 'VLsecond']);
  expect(result.songs).toHaveLength(1);
  expect(result.order).toEqual(['s:song', 'c:VLfirst', 'c:VLsecond']);
  expect(result.header).toBe(base.header);
  expect(result.title).toBe(base.title);
});

it('recognizes private listening shelves without marking public uploads private', () => {
  for (const title of ['Personal mix', 'Songs on repeat', 'Artists on repeat', 'Playlists on repeat', 'Videos on repeat']) {
    expect(isPrivateProfileSection(section(title))).toBe(true);
  }
  expect(isPrivateProfileSection(section('Public playlists'))).toBe(false);
  expect(isPrivateProfileSection(section('Public videos'))).toBe(false);
  expect(isPersonalMix(section('Personal mix (Private)'))).toBe(true);
  expect(profileSectionTitle(section('Songs on repeat · Private'))).toBe('Songs on repeat');
});

it('uses only artist names from the repeat shelf, deduplicating empty/repeated entries', () => {
  const artist = (title: string) => ({ title, browseId: `UC${title}`, thumbnails: [] });
  expect(repeatArtists([
    { ...section('Public playlists'), cards: [artist('Not a listening hint')] },
    { ...section('Artists on repeat'), cards: [artist('Artist A'), artist('Artist B'), artist('Artist A'), artist(' ')] },
  ])).toEqual(['Artist A', 'Artist B']);
  expect(repeatArtists([])).toEqual([]);
});
