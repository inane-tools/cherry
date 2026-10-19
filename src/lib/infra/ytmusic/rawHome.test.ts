import { expect, it } from 'vitest';
import { scanHome, scanHomeFilters, homeContinuation, scanPageHeader } from './rawHome';

const text = (value: string) => ({ runs: [{ text: value }] });
const card = (id: string) => ({ musicTwoRowItemRenderer: { title: text(id), navigationEndpoint: { browseEndpoint: { browseId: id } }, thumbnailRenderer: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: `https://image/${id}` }] } } } } });
const song = (id: string) => ({ musicResponsiveListItemRenderer: { flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: text(id) } }], overlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchEndpoint: { videoId: id } } } } } } } });
const shelf = (title: string, contents: object[], extra = {}) => ({ musicCarouselShelfRenderer: { header: { musicCarouselShelfBasicHeaderRenderer: { title: text(title) } }, contents, ...extra } });

it('retains shelf avatars, owner endpoints and separate More navigation', () => {
  const profile = { browseEndpoint: { browseId: 'UCowner', params: 'profile-params', browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_USER_CHANNEL' } } } };
  const [section] = scanHome(shelf('Listen again', [card('VLplaylist')], { header: { musicCarouselShelfBasicHeaderRenderer: {
    title: text('Listen again'), strapline: { runs: [{ text: 'SAME', navigationEndpoint: profile }] },
    thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://image.test/avatar', width: 96 }] } } },
    moreContentButton: { buttonRenderer: { navigationEndpoint: { browseEndpoint: { browseId: 'FEmusic_history', params: 'more' } } } },
  } } }));
  expect(section.header).toMatchObject({ subtitle: 'SAME', thumbnails: [{ url: 'https://image.test/avatar' }],
    profile: { browseId: 'UCowner', params: 'profile-params', pageType: 'MUSIC_PAGE_TYPE_USER_CHANNEL' }, more: { browseId: 'FEmusic_history', params: 'more' } });
});

it('keeps repeat shelves, personal mix endpoints, and public profile content', () => {
  const personalMix = { musicTwoRowItemRenderer: { title: text('Personal mix'), navigationEndpoint: { watchPlaylistEndpoint: { playlistId: 'RDpersonal', params: 'mix-params' } } } };
  const sections = scanHome({ contents: [shelf('Personal mix', [personalMix]), shelf('Songs on repeat', [song('repeat')]),
    shelf('Artists on repeat', [card('UCartist')]), shelf('Playlists on repeat', [card('VLrepeat')]),
    shelf('Videos on repeat', [song('video')]), shelf('Public playlists', [card('VLpublic')]), shelf('Public videos', [song('public')])] });
  expect(sections.map(section => section.title)).toEqual(['Personal mix', 'Songs on repeat', 'Artists on repeat', 'Playlists on repeat', 'Videos on repeat', 'Public playlists', 'Public videos']);
  expect(sections[0].cards[0].playback).toEqual({ playlistId: 'RDpersonal', params: 'mix-params' });
});

it('separates profile banners from avatars and keeps exact mix actions', () => {
  const image = (url: string) => ({ musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url }] } } });
  const header = scanPageHeader({ header: { musicVisualHeaderRenderer: { title: text('SAME'),
    thumbnail: image('https://image.test/banner'), foregroundThumbnail: image('https://image.test/avatar'),
    buttons: [{ musicPlayButtonRenderer: { accessibilityPlayData: { accessibilityData: { label: 'Play personal mix' } }, playNavigationEndpoint: { watchPlaylistEndpoint: { playlistId: 'RDpersonal', params: 'private-mix' } } } }],
    menu: { menuRenderer: { topLevelButtons: [{ buttonRenderer: { text: text('Share'), command: { shareEntityEndpoint: { serializedShareEntity: 'share' } } } }] } },
  } } });
  expect(header).toMatchObject({ title: 'SAME', thumbnails: [{ url: 'https://image.test/avatar' }], banner: [{ url: 'https://image.test/banner' }],
    actions: [{ label: 'Play personal mix', playback: { playlistId: 'RDpersonal', params: 'private-mix' } }, { label: 'Share', share: true }] });
});

it('retains immersive artist header art as a banner', () => {
  const banner = [{ url: 'https://image.test/artist-banner', width: 1920, height: 800 }];
  expect(scanPageHeader({ header: { musicImmersiveHeaderRenderer: { title: text('Artist'),
    thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: banner } } },
  } } })).toMatchObject({ title: 'Artist', banner });
});

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

it('distinguishes wrapping grids, vertical song lists and actual carousels', () => {
  expect(scanHome(shelf('Home carousel', [song('one')]))[0].presentation).toBe('carousel');
  expect(scanHome({ gridRenderer: { items: [card('VLgrid')] } })[0].presentation).toBe('grid');
  expect(scanHome({ musicShelfRenderer: { title: text('Songs'), contents: [song('one')] } })[0].presentation).toBe('list');
  expect(scanHome({ musicShelfRenderer: { title: text('From your library'), contents: [card('VLplaylist')] } })[0].presentation).toBe('grid');
});

it('follows the feed continuation instead of an individual shelf continuation', () => {
  expect(homeContinuation({ contents: { sectionListRenderer: { contents: [{ ...shelf('Songs', [song('one')]), continuations: [{ nextContinuationData: { continuation: 'shelf-only' } }] }], continuations: [{ nextContinuationData: { continuation: 'feed' } }] } } })).toBe('feed');
  expect(homeContinuation(shelf('Only shelf', [song('one')], { continuations: [{ nextContinuationData: { continuation: 'shelf-only' } }] }))).toBeNull();
  expect(homeContinuation({ continuationContents: { sectionListContinuation: { contents: [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'next' } } } }] } } })).toBe('next');
});

it('preserves shelf pagination independently of the profile page continuation', () => {
  const raw = { contents: { sectionListRenderer: { contents: [shelf('Public playlists', [card('VLfirst')], {
    continuations: [{ nextContinuationData: { continuation: 'playlist-shelf-next' } }],
  })], continuations: [{ nextContinuationData: { continuation: 'profile-next' } }] } } };
  expect(scanHome(raw)[0].continuation).toBe('playlist-shelf-next');
  expect(homeContinuation(raw)).toBe('profile-next');
});

it('parses grid and song continuation pages, including bare appended items', () => {
  const next = { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'next' } } } };
  const [grid] = scanHome({ continuationContents: { gridContinuation: { items: [
    { gridPlaylistRenderer: { title: text('More playlists'), navigationEndpoint: { browseEndpoint: { browseId: 'VLmore' } } } }, next,
  ] } } });
  expect(grid.cards[0].browseId).toBe('VLmore');
  expect(grid.continuation).toBe('next');
  const [rows] = scanHome({ continuationContents: { musicShelfContinuation: { contents: [song('repeat-more'), next] } } });
  expect(rows.songs[0].videoId).toBe('repeat-more');
  expect(rows.continuation).toBe('next');
  const [appended] = scanHome({ onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [card('VLappended'), next] } }] });
  expect(appended.cards[0].browseId).toBe('VLappended');
  expect(appended.continuation).toBe('next');
  expect(scanHome({ continuationContents: { musicShelfContinuation: { contents: [next] } } })[0].continuation).toBe('next');
});


it('keeps station watch endpoints and params instead of reducing them to songs', () => {
  const endpoint = { watchEndpoint: { videoId: 'seed', playlistId: 'RDstation', params: 'server-params' } };
  const [section] = scanHome(shelf('Listen together', [{ musicTwoRowItemRenderer: { title: text('Station'), navigationEndpoint: endpoint, thumbnailRenderer: { musicThumbnailRenderer: { thumbnail: { thumbnails: [] } } } } }]));
  expect(section.songs).toHaveLength(0);
  expect(section.cards[0]).toMatchObject({ browseId: 'VLRDstation', playback: { videoId: 'seed', playlistId: 'RDstation', params: 'server-params' } });
});
