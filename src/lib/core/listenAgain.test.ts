import { expect, it } from 'vitest';
import { withHomeProfile } from './listenAgain';
import type { HomeSection } from '$lib/infra/ytmusic/rawHome';
const shelf = (title: string): HomeSection => ({ title, cards: [], songs: [{ videoId: title, title, thumbnails: [{ url: 'https://image.test/art' }] }] });
it('preserves order and song artwork while using only the account avatar on the first visible shelf', () => {
  const target = { browseId: 'UCowner', params: 'private-profile' };
  const first = shelf('Recommendations');
  const later = { ...shelf('Listen again'), header: { profile: target, thumbnails: [{ url: 'https://image.test/wrong' }] } };
  const output = withHomeProfile([first, later], { name: 'Owner', avatarUrl: 'https://image.test/avatar' });
  expect(output.map(s => s.title)).toEqual(['Recommendations', 'Listen again']);
  expect(output[0].songs).toBe(first.songs);
  expect(output[0].header).toEqual({ profile: target, thumbnails: [{ url: 'https://image.test/avatar' }] });
  expect(output[1].header?.thumbnails).toEqual([]);
  expect(later.header.thumbnails).toHaveLength(1);
});
it('uses a real channel link when YouTube omits its profile endpoint, without adding any shelf', () => {
  const input = [shelf('Listen again'), shelf('More')];
  const output = withHomeProfile(input, { name: 'Owner', pageId: 'UCowner', avatarUrl: 'https://image.test/avatar' });
  expect(output).toHaveLength(2);
  expect(output[0].header?.profile).toEqual({ browseId: 'UCowner' });
  expect(withHomeProfile([], null)).toEqual([]);
});
