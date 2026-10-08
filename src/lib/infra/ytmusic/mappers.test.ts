import { describe, expect, it } from 'vitest';
import { mapAlbum, mapArtistRef, mapCardShelfResult, mapPlaylist, mapTrack } from './mappers';

describe('mapTrack', () => {
  it('maps a current search row', () => {
    const t = mapTrack({
      item_type: 'song',
      id: 'vid12345678',
      title: 'Song',
      artists: [{ name: 'Artist', channel_id: 'UCa' }],
      album: { name: 'Album', id: 'MPREb_x' },
      duration: { text: '3:34', seconds: 214 },
      thumbnail: { contents: [{ url: 'https://t/1', width: 60, height: 60 }] },
      badges: [{ label: 'Explicit' }],
    });
    expect(t).toEqual({
      videoId: 'vid12345678',
      title: 'Song',
      artists: [{ name: 'Artist', browseId: 'UCa' }],
      album: { name: 'Album', browseId: 'MPREb_x' },
      durationSeconds: 214,
      thumbnails: [{ url: 'https://t/1', width: 60, height: 60 }],
      isExplicit: true,
    });
  });

  it('reads durations from text, columns and overlays', () => {
    expect(mapTrack({ video_id: 'v', title: 'T', duration: '1:02:03' })?.durationSeconds).toBe(3723);
    expect(
      mapTrack({
        video_id: 'v',
        title: 'T',
        flex_columns: [{ title: { text: 'T' } }, { title: { runs: [{ text: 'A' }, { text: ' • ' }, { text: '4:05' }] } }],
      })?.durationSeconds,
    ).toBe(245);
    expect(
      mapTrack({ video_id: 'v', title: 'T', thumbnail_overlay_badges: [{ text: '2:00' }] })?.durationSeconds,
    ).toBe(120);
  });

  it('finds the video id on a watch endpoint', () => {
    expect(
      mapTrack({ title: { text: 'T' }, endpoint: { name: 'watchEndpoint', payload: { videoId: 'w' } } })?.videoId,
    ).toBe('w');
  });

  it('never turns library rows or junk into tracks', () => {
    expect(mapTrack({ item_type: 'album', id: 'MPR', title: 'A' })).toBeNull();
    expect(mapTrack({ item_type: 'song', title: 'no id' })).toBeNull();
    expect(mapTrack(null)).toBeNull();
    expect(mapTrack('string')).toBeNull();
  });

  it('pulls artists out of flex-column runs as a fallback', () => {
    const t = mapTrack({
      video_id: 'v',
      title: 'T',
      flex_columns: [
        { title: { text: 'T' } },
        {
          title: {
            runs: [
              { text: 'Artist A', endpoint: { name: 'browseEndpoint' } },
              { text: ' • ', endpoint: { name: 'browseEndpoint' } },
              { text: 'Album', endpoint: { name: 'other' } },
            ],
          },
        },
      ],
    });
    expect(t?.artists).toEqual([{ name: 'Artist A' }]);
  });
});

describe('mapCardShelfResult', () => {
  const card = (payload: object, extra: object = {}) => ({
    type: 'MusicCardShelf',
    title: { text: 'Top' },
    on_tap: { payload },
    ...extra,
  });

  it('maps a playable top result to a track', () => {
    const r = mapCardShelfResult(
      card({ videoId: 'v1' }, { subtitle: { runs: [{ text: 'Song' }, { text: ' • ' }, { text: 'Artist' }, { text: ' • ' }, { text: 'Album' }, { text: ' • ' }, { text: '3:00' }] } }),
    );
    expect(r.track).toMatchObject({ videoId: 'v1', artists: [{ name: 'Artist' }], album: { name: 'Album' }, durationSeconds: 180 });
  });

  it('recognises artist, album and playlist cards', () => {
    expect(mapCardShelfResult(card({ browseId: 'UCabc' })).artist?.browseId).toBe('UCabc');
    expect(mapCardShelfResult(card({ browseId: 'MPREb_1' })).album?.browseId).toBe('MPREb_1');
    expect(mapCardShelfResult(card({ browseId: 'PLxyz' })).playlist?.browseId).toBe('VLPLxyz');
    expect(mapCardShelfResult(card({ browseId: 'OTHER' }))).toEqual({});
  });
});

describe('mapPlaylist', () => {
  it('reads an explicit count', () => {
    expect(mapPlaylist({ browse_id: 'VL1', title: 'P', count: { text: '1,234 songs' } })?.trackCount).toBe(1234);
  });

  // Regression: every digit in the subtitle was concatenated (year + count).
  it('takes the count from the songs run, not the whole subtitle', () => {
    const p = mapPlaylist({
      browse_id: 'VL1',
      title: 'P',
      subtitle: {
        runs: [
          { text: 'Playlist' },
          { text: ' • ' },
          { text: 'Me', endpoint: { name: 'browseEndpoint' } },
          { text: ' • ' },
          { text: '2024' },
          { text: ' • ' },
          { text: '25 songs' },
        ],
      },
    });
    expect(p?.trackCount).toBe(25);
    expect(p?.author).toBe('Me');
  });

  it('leaves the count unknown when no run names one', () => {
    const p = mapPlaylist({ item_type: 'playlist', id: 'VL2', title: 'P', subtitle: { runs: [{ text: '2024' }] } });
    expect(p?.trackCount).toBeUndefined();
  });

  it('needs an id and a title', () => {
    expect(mapPlaylist({ title: 'x' })).toBeNull();
    expect(mapPlaylist({ browse_id: 'VL1' })).toBeNull();
  });
});

describe('mapAlbum / mapArtistRef', () => {
  it('maps albums', () => {
    expect(mapAlbum({ id: 'MPR1', title: 'A', year: '2020', artists: [{ name: 'X' }] })).toMatchObject({
      browseId: 'MPR1',
      year: '2020',
      artists: [{ name: 'X' }],
    });
    expect(mapAlbum({ title: 'no id' })).toBeNull();
  });

  it('finds the artist id on an endpoint when the row has none', () => {
    expect(mapArtistRef({ name: 'N', endpoint: { payload: { browseId: 'UC9' } } })?.browseId).toBe('UC9');
    expect(mapArtistRef({ name: { text: 'N' } })?.browseId).toBeUndefined();
    expect(mapArtistRef({})).toBeNull();
  });
});
