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
  it('reads empty and video-only playlists from web lockups and follows rich-grid pages', () => {
    const item = (id: string, contentType = 'LOCKUP_CONTENT_TYPE_PLAYLIST') => ({ richItemRenderer: { content: { lockupViewModel: {
      contentId: id, contentType,
      metadata: { lockupMetadataViewModel: { title: { content: 'Empty playlist' } } },
      contentImage: { collectionThumbnailViewModel: { primaryThumbnail: { thumbnailViewModel: { image: { sources: [{ url: 'https://img/empty', width: 336 }] } } } } },
    } } } });
    const scan = scanLibrary({ richGridRenderer: { contents: [item('PLempty'), item('video', 'LOCKUP_CONTENT_TYPE_VIDEO'),
      { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'web-next' } } } }],
    } });
    expect(scan.playlists).toEqual([{ browseId: 'VLPLempty', title: 'Empty playlist', author: undefined, trackCount: undefined, thumbnails: [{ url: 'https://img/empty', width: 336 }] }]);
    expect(scan.continuation).toBe('web-next');
  });
  it('only follows the playlist container continuation, never a sort-menu reload', () => {
    expect(scanLibrary({
      header: { menuRenderer: { continuations: [{ reloadContinuationData: { continuation: 'sort-token' } }] } },
      contents: { gridRenderer: { items: [twoRow('VLPL1', 'First')], continuations: [{ nextContinuationData: { continuation: 'library-token' } }] } },
    }).continuation).toBe('library-token');
  });
  it('reads grid continuation data without following unrelated menu commands', () => {
    const scan = scanLibrary({ contents: { gridRenderer: {
      items: [twoRow('VLPL1', 'First')],
      menu: { continuationCommand: { token: 'not-library' } },
      continuations: [{ nextContinuationData: { continuation: 'library-next' } }],
    } } });
    expect(scan.continuation).toBe('library-next');
  });
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
