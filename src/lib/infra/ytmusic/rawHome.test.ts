import { expect, it } from 'vitest';
import { scanHome, scanHomeFilters, homeContinuation } from './rawHome';

const text = (value: string) => ({ runs: [{ text: value }] });
const card = (id: string) => ({ musicTwoRowItemRenderer: { title: text(id), navigationEndpoint: { browseEndpoint: { browseId: id } }, thumbnailRenderer: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: `https://image/${id}` }] } } } } });
const song = (id: string) => ({ musicResponsiveListItemRenderer: { flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: text(id) } }], overlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchEndpoint: { videoId: id } } } } } } } });
const shelf = (title: string, contents: object[], extra = {}) => ({ musicCarouselShelfRenderer: { header: { musicCarouselShelfBasicHeaderRenderer: { title: text(title) } }, contents, ...extra } });

it('finds songs whose watch endpoint exists only in the overlay and preserves mixed ordering', () => {
  const [section] = scanHome(shelf('For you', [song('one'), card('VLplaylist'), song('two')]));
  expect(section.songs.map((s) => s.videoId)).toEqual(['one', 'two']);
  expect(section.order).toEqual(['s:one', 'c:VLplaylist', 's:two']);
});

it('supports multi-row cards and navigation buttons with distinct parameters', () => {
  const button = (params: string) => ({ musicNavigationButtonRenderer: { buttonText: text(params), clickCommand: { browseEndpoint: { browseId: 'FEmusic_moods_and_genres_detail', params } } } });
  const sections = scanHome({ contents: [shelf('Moods', [button('focus'), button('relax')]), shelf('Recommendations', [{ musicMultiRowListItemRenderer: { title: text('Album'), onTap: { browseEndpoint: { browseId: 'MPRalbum' } } } }])] });
  expect(sections[0].layout).toBe('buttons');
  expect(sections[0].cards.map((c) => c.params)).toEqual(['focus', 'relax']);
  expect(sections[0].order).toHaveLength(2);
  expect(sections[1].cards[0].browseId).toBe('MPRalbum');
});

it('preserves document order across nested sections and does not drop matching section titles', () => {
  const sections = scanHome({ contents: [{ nested: shelf('Same title', [card('VLfirst')]) }, shelf('Same title', [card('VLsecond')])] });
  expect(sections.map((s) => s.cards[0].browseId)).toEqual(['VLfirst', 'VLsecond']);
});

it('keeps upstream song-row counts and parses Home filters', () => {
  expect(scanHome(shelf('Quick picks', [song('one')], { numItemsPerColumn: '4' }))[0]).toMatchObject({ layout: 'songs', rows: 4 });
  expect(scanHomeFilters({ chipCloudRenderer: { chips: [{ chipCloudChipRenderer: { text: text('Focus'), navigationEndpoint: { browseEndpoint: { browseId: 'FEmusic_home', params: 'focus' } } } }] } })).toEqual([{ label: 'Focus', browseId: 'FEmusic_home', params: 'focus' }]);
});

it('follows the feed continuation instead of an individual shelf continuation', () => {
  expect(homeContinuation({ contents: { sectionListRenderer: { contents: [{ ...shelf('Songs', [song('one')]), continuations: [{ nextContinuationData: { continuation: 'shelf-only' } }] }], continuations: [{ nextContinuationData: { continuation: 'feed' } }] } } })).toBe('feed');
  expect(homeContinuation(shelf('Only shelf', [song('one')], { continuations: [{ nextContinuationData: { continuation: 'shelf-only' } }] }))).toBeNull();
  expect(homeContinuation({ continuationContents: { sectionListContinuation: { contents: [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'next' } } } }] } } })).toBe('next');
});


it('keeps station watch endpoints and params instead of reducing them to songs', () => {
  const endpoint = { watchEndpoint: { videoId: 'seed', playlistId: 'RDstation', params: 'server-params' } };
  const [section] = scanHome(shelf('Listen together', [{ musicTwoRowItemRenderer: { title: text('Station'), navigationEndpoint: endpoint, thumbnailRenderer: { musicThumbnailRenderer: { thumbnail: { thumbnails: [] } } } } }]));
  expect(section.songs).toHaveLength(0);
  expect(section.cards[0]).toMatchObject({ browseId: 'VLRDstation', playback: { videoId: 'seed', playlistId: 'RDstation', params: 'server-params' } });
});
