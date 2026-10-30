/** Relative to this album only; missing counts must not look like zero plays. */
export function popularityLevel(count: number | undefined, maximum: number): number | undefined {
  if (count === undefined || !Number.isFinite(count) || count < 0) return undefined;
  if (count === 0 || maximum <= 0) return 0;
  return Math.max(1, Math.min(5, Math.ceil(count / maximum * 5)));
}
