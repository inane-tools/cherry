import { expect, it } from 'vitest';
import { homeGreeting } from './homeGreeting';
import { repeatListening } from './profileSections';

const empty = { artists: [], songs: [], playlists: [] };

it('ends questions with a question mark after the name, including personalized questions', () => {
  const lines = Array.from({ length: 20 }, (_, i) => homeGreeting(2, 'SAME', empty, { personal: 1, line: (i + 0.5) / 20 }));
  expect(lines).toContain('Still up, SAME?');
  expect(lines).toContain('What are we listening to, SAME?');
  expect(lines).toContain('Something familiar or something new, SAME?');
  expect(homeGreeting(2, '', empty, { personal: 1, line: 0 })).toBe('Still up?');
  expect(homeGreeting(9, 'SAME', { ...empty, artists: ['Artist'] }, { personal: 0, line: 0.3 })).toBe('Back for more Artist, SAME?');
  expect(homeGreeting(9, 'SAME', { ...empty, songs: ['Song'] }, { personal: 0, line: 0.9 })).toBe('Still got “Song” on your mind, SAME?');
  expect(homeGreeting(9, 'SAME', { ...empty, playlists: ['Playlist'] }, { personal: 0, line: 0.9 })).toBe('Another round of “Playlist”, perhaps, SAME?');
});

it('uses regular greetings on 88% of the choice range, even with listening hints', () => {
  const hints = { artists: ['Artist A'], songs: ['Song B'], playlists: ['Playlist C'] };
  for (let i = 12; i < 100; i++) {
    expect(homeGreeting(9, 'SAME', hints, { personal: i / 100, line: 0 })).toBe('Good morning, SAME.');
  }
  expect(homeGreeting(9, 'SAME', empty, { personal: 0, line: 0 })).toBe('Good morning, SAME.');
});

it('can reference artists, songs and playlists without inventing listening statistics', () => {
  for (const kind of ['artists', 'songs', 'playlists'] as const) {
    const hints = { ...empty, [kind]: ['A familiar favorite'] };
    expect(homeGreeting(18, 'SAME', hints, { personal: 0, line: 0 })).toContain('A familiar favorite');
  }
});

it('avoids the previous line and offers twenty regular greetings per time period', () => {
  for (const hour of [2, 9, 15, 21]) {
    const lines = new Set(Array.from({ length: 20 }, (_, i) => homeGreeting(hour, 'SAME', empty, { personal: 1, line: (i + 0.5) / 20 })));
    expect(lines.size).toBe(20);
    const previous = homeGreeting(hour, 'SAME', empty, { personal: 1, line: 0 });
    expect(homeGreeting(hour, 'SAME', empty, { personal: 1, line: 0 }, previous)).not.toBe(previous);
  }
});

it('reads only repeat shelves and leaves unrelated recommendations out', () => {
  expect(repeatListening([
    { title: 'Songs on repeat', cards: [], songs: [{ title: 'Song A', videoId: 'a', thumbnails: [] }] },
    { title: 'Playlists on repeat', songs: [], cards: [{ title: 'Playlist B', browseId: 'VLb', thumbnails: [] }] },
    { title: 'Recommended', cards: [{ title: 'Not history', browseId: 'VLc', thumbnails: [] }], songs: [] },
  ])).toEqual({ artists: [], songs: ['Song A'], playlists: ['Playlist B'] });
});
