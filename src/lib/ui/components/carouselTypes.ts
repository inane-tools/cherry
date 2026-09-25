// Shared carousel entry shape.
//
// A carousel row mixes album/playlist cards and songs, so both are normalised
// into one entry type and the carousel stays agnostic about the source.

import type { Thumbnail } from '$lib/core/models';

export interface CarouselEntry {
  key: string;
  title: string;
  subtitle?: string;
  thumbnails: Thumbnail[];
  kind: 'card' | 'song';
}
