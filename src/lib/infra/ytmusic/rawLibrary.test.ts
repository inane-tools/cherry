import { describe, expect, it } from 'vitest';
import { scanAddablePlaylists, scanLibrary } from './rawLibrary';

const twoRow = (id: string, title: string, pageType = 'MUSIC_PAGE_TYPE_PLAYLIST') => ({
  musicTwoRowItemRenderer: {
    title: { runs: [{ text: title }] },
    subtitle: { runs: [{ text: 'Owner • 12 songs' }] },
    thumbnailRenderer: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: `https://img/${id}`, width: 226 }] } } },
    navigationEndpoint: {
      browseEndpoint: {
        browseId: id,
        browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } },
      },
    },
  },
});

describe('scanLibrary', () => {
  it('extracts playlists in document order, skipping albums and duplicates', () => {
    const raw = {
      contents: {
        sectionListRenderer: {
          contents: [
            { itemSectionRenderer: { contents: [{ somethingElseRenderer: {} }] } },
            {
              gridRenderer: {
                items: [
                  twoRow('VLLM', 'Liked music'),
                  twoRow('VLPL1', 'Mix'),
                  twoRow('MPREb_1', 'An album', 'MUSIC_PAGE_TYPE_ALBUM'),
                  twoRow('VLPL1', 'Mix again'),
                ],
                continuations: [{ nextContinuationData: {} }],
              },
            },
          ],
        },
      },
      continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'NEXT' } } },
    };
    const scan = scanLibrary(raw);
    expect(scan.playlists.map((p) => p.browseId)).toEqual(['VLLM', 'VLPL1']);
    expect(scan.playlists[0]).toMatchObject({ title: 'Liked music', author: 'Owner', thumbnails: [{ url: 'https://img/VLLM', width: 226 }] });
    expect(scan.continuation).toBe('NEXT');
    expect(scan.rendererCounts.musicTwoRowItemRenderer).toBe(4);
  });

  it('reads responsive list rows (title + owner from flex columns)', () => {
    const raw = {
      musicResponsiveListItemRenderer: {
        flexColumns: [
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Row title' }] } } },
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Someone' }] } } },
        ],
        navigationEndpoint: { browseEndpoint: { browseId: 'VLPL9' } },
      },
    };
    expect(scanLibrary(raw).playlists).toEqual([
      { browseId: 'VLPL9', title: 'Row title', author: 'Someone', trackCount: undefined, thumbnails: [] },
    ]);
  });

  it('tolerates junk', () => {
    expect(scanLibrary(null).playlists).toEqual([]);
    expect(scanLibrary({ a: [1, 'x', null] }).playlists).toEqual([]);
  });
});

describe('scanAddablePlaylists', () => {
  it('finds editable playlist options and normalises ids to VL…', () => {
    const raw = {
      contents: [
        {
          addToPlaylistRenderer: {
            playlists: [
              { playlistAddToOptionRenderer: { playlistId: 'PLa', title: { simpleText: 'First' } } },
              { playlistAddToOptionRenderer: { playlistId: 'VLPLb', title: { runs: [{ text: 'Second' }] } } },
              { playlistAddToOptionRenderer: { playlistId: 'PLa', title: { simpleText: 'Dup' } } },
              { somethingRenderer: { title: { simpleText: 'No id' } } },
            ],
          },
        },
      ],
    };
    expect(scanAddablePlaylists(raw).map((p) => [p.browseId, p.title])).toEqual([
      ['VLPLa', 'First'],
      ['VLPLb', 'Second'],
    ]);
  });
});
