import { describe, expect, it } from 'vitest';
import { bestThumbnail, hiResThumbnail, trackDisplayArtists } from './models';

describe('bestThumbnail', () => {
  const thumbs = [
    { url: 'large', width: 544 },
    { url: 'small', width: 60 },
    { url: 'mid', width: 226 },
  ];
  it('picks the smallest thumbnail that is at least the requested size', () => {
    expect(bestThumbnail(thumbs, 200)).toBe('mid');
    expect(bestThumbnail(thumbs, 60)).toBe('small');
  });
  it('falls back to the largest when none is big enough', () => {
    expect(bestThumbnail(thumbs, 1000)).toBe('large');
  });
  it('handles empty lists and missing widths', () => {
    expect(bestThumbnail([])).toBe('');
    expect(bestThumbnail([{ url: 'only' }])).toBe('only');
  });
  it('does not reorder the caller’s array', () => {
    const copy = [...thumbs];
    bestThumbnail(thumbs);
    expect(thumbs).toEqual(copy);
  });
});

describe('hiResThumbnail', () => {
  it('upgrades ytimg video thumbnails to maxresdefault, keeping the query', () => {
    expect(hiResThumbnail('https://i.ytimg.com/vi/abc123/hqdefault.jpg?sqp=x')).toBe(
      'https://i.ytimg.com/vi/abc123/maxresdefault.jpg?sqp=x',
    );
    expect(hiResThumbnail('https://i.ytimg.com/vi_webp/abc/mqdefault.webp')).toBe(
      'https://i.ytimg.com/vi_webp/abc/maxresdefault.jpg',
    );
  });
  it('rewrites Google CDN size parameters', () => {
    expect(hiResThumbnail('https://lh3.googleusercontent.com/x=w226-h226-l90-rj', 800)).toBe(
      'https://lh3.googleusercontent.com/x=w800-h800-l90-rj',
    );
  });
  it('leaves other URLs and empty strings alone', () => {
    expect(hiResThumbnail('')).toBe('');
    expect(hiResThumbnail('https://example.com/a.png')).toBe('https://example.com/a.png');
  });
});

describe('trackDisplayArtists', () => {
  it('joins names and has a fallback', () => {
    expect(trackDisplayArtists({ artists: [{ name: 'A' }, { name: 'B' }] })).toBe('A, B');
    expect(trackDisplayArtists({ artists: [] })).toBe('Unknown artist');
  });
});
