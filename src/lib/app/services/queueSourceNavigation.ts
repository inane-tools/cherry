import type { QueueSource } from '$lib/core/models';
import { openMix } from './mixes';
import { openAlbum } from './catalog';
import { openPlaylist } from './playlists';

export function openQueueSource(source: QueueSource): void {
  if (source.kind === 'mix') { if (source.endpoint) openMix(source.endpoint, source.title); }
  else if (source.kind === 'album' && source.browseId) openAlbum({ browseId: source.browseId, title: source.title, artists: [], thumbnails: source.thumbnails ?? [] });
  else if (source.browseId) openPlaylist({ browseId: source.browseId, title: source.title, thumbnails: source.thumbnails ?? [] });
}
