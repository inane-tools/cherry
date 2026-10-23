import type { ArtistRef, Track } from '$lib/core/models';
import { isNoiseSegment } from './rawHome';

type Run = any;
function browse(run: Run): any {
  return run?.navigationEndpoint?.browseEndpoint ?? run?.endpoint?.payload;
}
function isAlbum(run: Run): boolean {
  const endpoint = browse(run);
  return endpoint?.browseId?.startsWith('MPR')
    || endpoint?.browseEndpointContextSupportedConfigs?.browseEndpointMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ALBUM';
}

export function albumFromRuns(runs: Run[]): Track['album'] {
  const run = runs.find(isAlbum);
  return run?.text ? { name: run.text, browseId: browse(run).browseId } : undefined;
}

export function artistsFromRuns(runs: Run[]): ArtistRef[] {
  const linked = runs.filter(run => browse(run)?.browseId?.startsWith('UC'));
  if (linked.length) return linked.map(run => ({ name: run.text, browseId: browse(run).browseId }));
  // Unlinked composers are common on soundtracks. Use the first artist-like
  // metadata group, excluding album links, media labels, years and durations.
  const groups: Run[][] = [[]];
  for (const run of runs) {
    if (/^\s*[•·]\s*$/.test(run.text ?? '')) groups.push([]);
    else groups.at(-1)!.push(run);
  }
  for (const group of groups) {
    const name = group.map(run => run.text ?? '').join('').trim();
    if (group.some(isAlbum) || isNoiseSegment(name) || /^\d+(?::\d{2})+$/.test(name)) continue;
    if (name) return [{ name }];
  }
  return [];
}
