import { writable } from 'svelte/store';

export const videoQualities = writable<number[]>([]);

export interface VideoRepresentation { id: string; height: number; bandwidth: number }

/** Keep the saved preference intact when a particular video has fewer streams. */
export function pickVideoRepresentation<T extends VideoRepresentation>(streams: T[], quality: string): T | undefined {
  const target = Number(quality);
  const sorted = streams.filter(stream => stream.height > 0)
    .sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
  if (quality === 'highest') return sorted[0];
  if (!Number.isFinite(target) || target <= 0 || !streams.length) return undefined;
  return sorted.find(stream => stream.height <= target) ?? sorted.at(-1);
}

/** Start Auto at the best available stream, then let throughput guide it. */
export function initialVideoBitrate(manifest: string, quality: string): number {
  const document = new DOMParser().parseFromString(manifest, 'application/xml');
  const streams = Array.from(document.querySelectorAll('AdaptationSet[contentType="video"] Representation'))
    .map(node => ({ id: node.getAttribute('id') ?? '', height: Number(node.getAttribute('height')), bandwidth: Number(node.getAttribute('bandwidth')) }))
    .filter(stream => stream.height > 0 && stream.bandwidth > 0);
  const preferred = pickVideoRepresentation(streams, quality === 'auto' ? 'highest' : quality);
  return preferred ? preferred.bandwidth / 1000 : 4000;
}
