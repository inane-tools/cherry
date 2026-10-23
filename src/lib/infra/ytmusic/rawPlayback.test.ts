import { expect, it } from 'vitest';
import { parseLyrics, lyricsBrowseId, parseRadio, musicVideoCounterpart, panelTrack } from './rawPlayback';
const video = (videoId: string, kind = 'MUSIC_VIDEO_TYPE_ATV') => ({ videoId, title: { simpleText: videoId }, thumbnail: { thumbnails: [] }, lengthText: { simpleText: '3:20' }, navigationEndpoint: { watchEndpoint: { watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: kind } } } } });

it('keeps soundtrack composers separate from album/year metadata in raw queues', () => {
  const byline = { runs: [{ text: 'Kuniyuki Takahashi' }, { text: ' • ' }, {
    text: 'NieR:Automata Ver1.1a Original Soundtrack', navigationEndpoint: { browseEndpoint: { browseId: 'MPREb_W02rOERpy4r' } },
  }, { text: ' • ' }, { text: '2023' }] };
  const row = { ...video('FjztDd3a8MU'), longBylineText: byline };
  expect(panelTrack(row)).toMatchObject({ artists: [{ name: 'Kuniyuki Takahashi' }],
    album: { name: 'NieR:Automata Ver1.1a Original Soundtrack', browseId: 'MPREb_W02rOERpy4r' } });
  expect(panelTrack({ ...row, shortBylineText: { runs: [{ text: 'Kuniyuki Takahashi' }] } })?.artists)
    .toEqual([{ name: 'Kuniyuki Takahashi' }]);
});

it('parses real timestamp units and source attribution without fabricating sync', () => {
  const data = { timedLyricsData: [{ lyricLine: 'First', cueRange: { startTimeMilliseconds: '1230', endTimeMilliseconds: '5000' } }], sourceMessage: 'Provider' };
  expect(parseLyrics(data)).toEqual({ synced: true, source: 'Provider', lines: [{ text: 'First', startSeconds: 1.23, endSeconds: 5 }] });
  expect(parseLyrics({ timedLyricsData: [{ lyricLine: 'Untimed' }] })).toMatchObject({ synced: false, lines: [{ text: 'Untimed' }] });
  expect(parseLyrics({ musicDescriptionShelfRenderer: { description: { runs: [{ text: 'One\nTwo' }] }, footer: { simpleText: 'Provider' } } })).toMatchObject({ synced: false, source: 'Provider', lines: [{ text: 'One' }, { text: 'Two' }] });
  expect(parseLyrics({ messageRenderer: { text: 'Unavailable' } })).toBeNull();
});
it('finds lyrics endpoints without relying on English tab titles', () => {
  expect(lyricsBrowseId({ tabs: [{ navigationEndpoint: { browseEndpoint: { browseId: 'MPLYsong' } } }] })).toBe('MPLYsong');
  expect(lyricsBrowseId({ unrelated: { browseId: 'MPREalbum' } })).toBeUndefined();
});
it('unwraps station queue rows, deduplicates and retains continuation tokens', () => {
  const wrapped = { primaryRenderer: { playlistPanelVideoRenderer: video('song') }, counterpart: [{ counterpartRenderer: { playlistPanelVideoRenderer: video('official', 'MUSIC_VIDEO_TYPE_OMV') } }] };
  const page = { playlistPanelRenderer: { playlistId: 'RDstation', contents: [{ playlistPanelVideoWrapperRenderer: wrapped }, { playlistPanelVideoRenderer: video('song') }, { playlistPanelVideoRenderer: video('next') }], continuations: [{ nextContinuationData: { continuation: 'continue' } }] } };
  expect(parseRadio(page)).toMatchObject({ playlistId: 'RDstation', continuation: 'continue', tracks: [{ videoId: 'song', durationSeconds: 200 }, { videoId: 'next' }] });
  expect(musicVideoCounterpart(page, 'song')).toMatchObject({ videoId: 'official', isMusicVideo: true });
  expect(musicVideoCounterpart(page, 'other')).toBeNull();
  expect(parseRadio({ playlistPanelContinuation: { contents: [{ playlistPanelVideoRenderer: video('continued') }] } }).tracks[0].videoId).toBe('continued');
});
