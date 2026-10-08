import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({}));
vi.mock('./player', () => ({}));
vi.mock('./playlists', () => ({}));

const { parseYouTubeLink } = await import('./openLink');
const links = await import('./links');

describe('parseYouTubeLink', () => {
  it('recognises watch, short and playlist links', () => {
    expect(parseYouTubeLink('https://music.youtube.com/watch?v=abc&list=PL1')).toEqual({ kind: 'track', videoId: 'abc' });
    expect(parseYouTubeLink('https://www.youtube.com/watch?v=abc')).toEqual({ kind: 'track', videoId: 'abc' });
    expect(parseYouTubeLink('youtu.be/xyz?t=3')).toEqual({ kind: 'track', videoId: 'xyz' });
    expect(parseYouTubeLink('m.youtube.com/playlist?list=PL2')).toEqual({ kind: 'playlist', playlistId: 'PL2' });
  });

  it('ignores ordinary searches and other sites', () => {
    expect(parseYouTubeLink('daft punk')).toBeNull();
    expect(parseYouTubeLink('https://example.com/watch?v=abc')).toBeNull();
    expect(parseYouTubeLink('https://youtube.com.evil.com/watch?v=abc')).toBeNull();
    expect(parseYouTubeLink('https://youtube.com/')).toBeNull();
    expect(parseYouTubeLink('')).toBeNull();
  });
});

describe('links', () => {
  it('builds canonical URLs and strips the VL prefix', () => {
    expect(links.trackMusicUrl('a b')).toBe('https://music.youtube.com/watch?v=a%20b');
    expect(links.playlistMusicUrl('VLPL1')).toBe('https://music.youtube.com/playlist?list=PL1');
    expect(links.playlistYouTubeUrl('PL1')).toBe('https://www.youtube.com/playlist?list=PL1');
  });
});
