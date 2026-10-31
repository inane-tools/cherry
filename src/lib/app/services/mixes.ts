import type { RadioEndpoint, Thumbnail } from '$lib/core/models';
import { openPage } from './navigation';

export function openMix(endpoint: RadioEndpoint, title = 'Mix', thumbnails: Thumbnail[] = []): void {
  if (!endpoint.playlistId && !endpoint.videoId) return;
  openPage({ view: 'browse', entity: { kind: 'mix', title, thumbnails, endpoint: { ...endpoint },
    browseId: endpoint.playlistId ?? `mix:${endpoint.videoId}`, params: endpoint.params } });
}
