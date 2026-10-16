import type { Lyrics, Track } from '$lib/core/models';

export function parseLrc(lrc: string): Lyrics | null {
  let offset = 0;
  const offsetMatch = lrc.match(/\[offset:([+-]?\d+)\]/i);
  if (offsetMatch) offset = Number(offsetMatch[1]) / 1000;
  const lines: { text: string; startSeconds: number; endSeconds?: number }[] = [];
  for (const row of lrc.split(/\r?\n/)) {
    const tags = [...row.matchAll(/\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const text = row.replace(/\[[^\]]*\]/g, '').trim();
    for (const tag of tags) {
      if (Number(tag[2]) >= 60) continue;
      lines.push({ text, startSeconds: Math.max(0, Number(tag[1]) * 60 + Number(tag[2]) + Number(`0.${tag[3] ?? '0'}`) + offset) });
    }
  }
  lines.sort((a, b) => a.startSeconds - b.startSeconds);
  lines.forEach((line, index) => { const next = lines[index + 1]; if (next) line.endSeconds = next.startSeconds; });
  return lines.some(line => line.text) ? { lines, synced: true, source: 'LRCLIB' } : null;
}

/** A bounded, exact metadata lookup; no session cookies are sent to LRCLIB. */
export async function lookupLyrics(track: Track, duration: number): Promise<Lyrics | null> {
  if (!track.title || !track.artists?.[0]?.name || !Number.isFinite(duration) || duration <= 0) return null;
  const query = new URLSearchParams({ track_name: track.title, artist_name: track.artists[0].name, duration: String(Math.round(duration)) });
  if (track.album?.name) query.set('album_name', track.album.name);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://lrclib.net/api/get?${query}`, { signal: controller.signal, credentials: 'omit' });
    if (!response.ok) return null;
    const data = await response.json();
    const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (typeof data.trackName !== 'string' || normalize(data.trackName) !== normalize(track.title)) return null;
    if (typeof data.artistName !== 'string' || !normalize(data.artistName).includes(normalize(track.artists[0].name))) return null;
    // Do not synchronize a different edit, live version or music-video intro.
    if (!Number.isFinite(data.duration) || Math.abs(data.duration - duration) > 2) return null;
    const synced = typeof data.syncedLyrics === 'string' ? parseLrc(data.syncedLyrics) : null;
    if (synced) return synced;
    if (typeof data.plainLyrics === 'string' && data.plainLyrics.trim()) {
      return { synced: false, source: 'LRCLIB', lines: data.plainLyrics.trim().split(/\r?\n/).map((text: string) => ({ text })) };
    }
    return null;
  } catch { return null; }
  finally { clearTimeout(timeout); }
}
