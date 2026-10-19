import type { QueueItem, Track } from './models';

/** Resolve one row, preserving duplicate occurrences across queue shuffle and reloads. */
export function playingTrackIndex(tracks: Track[], current: QueueItem | null): number {
  if (!current) return -1;
  if (current.track.playlistEntryId) {
    const entry = tracks.findIndex(track => track.playlistEntryId === current.track.playlistEntryId);
    if (entry >= 0) return entry;
    if (tracks.some(track => track.videoId === current.track.videoId && track.playlistEntryId)) return -1;
  }
  const matches: number[] = [];
  const references: number[] = [];
  tracks.forEach((track, index) => {
    if (track.videoId === current.track.videoId) matches.push(index);
    if (track === current.track) references.push(index);
  });
  if (references.length === 1) return references[0];
  return matches[current.sourceOccurrence ?? 0] ?? matches[0] ?? -1;
}
