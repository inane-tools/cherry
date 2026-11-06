import type { Track } from './models';

/** Retain confirmed writes while YouTube's playlist reads catch up. */
export class PlaylistAdditions {
  private pending = new Map<string, Array<{ track: Track; minimum: number }>>();

  record(key: string, tracks: Track[], baseline: Track[] = [], liked = false): void {
    const counts = this.counts(baseline);
    const pending = this.pending.get(key) ?? [];
    for (const entry of pending) counts.set(entry.track.videoId, Math.max(counts.get(entry.track.videoId) ?? 0, entry.minimum));
    for (const { playlistEntryId: _sourceEntry, ...track } of tracks) {
      if (liked && pending.some(entry => entry.track.videoId === track.videoId)) continue;
      const minimum = liked ? 1 : (counts.get(track.videoId) ?? 0) + 1;
      counts.set(track.videoId, minimum);
      pending.push({ track, minimum });
    }
    if (pending.length) this.pending.set(key, pending);
  }

  reconcile(key: string, tracks: Track[], complete = false): Track[] {
    const pending = this.pending.get(key);
    if (!pending) return tracks;
    const counts = this.counts(tracks);
    const extra: Track[] = [];
    const remaining = pending.filter(entry => {
      const missing = (counts.get(entry.track.videoId) ?? 0) < entry.minimum;
      if (missing) extra.push({ ...entry.track });
      return missing || !complete;
    });
    if (remaining.length) this.pending.set(key, remaining); else this.pending.delete(key);
    return extra.length ? [...tracks, ...extra] : tracks;
  }

  remove(key: string, videoId: string): void {
    const remaining = this.pending.get(key)?.filter(entry => entry.track.videoId !== videoId || --entry.minimum > 0);
    if (remaining?.length) this.pending.set(key, remaining); else this.pending.delete(key);
  }

  clear(key?: string): void { if (key === undefined) this.pending.clear(); else this.pending.delete(key); }
  private counts(tracks: Track[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const track of tracks) counts.set(track.videoId, (counts.get(track.videoId) ?? 0) + 1);
    return counts;
  }
}
