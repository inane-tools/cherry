/** Relative to this album only; missing counts must not look like zero plays. */
export function popularityLevel(count: number | undefined, maximum: number, minimum = 0): number | undefined {
  if (count === undefined || !Number.isFinite(count) || count < 0) return undefined;
  // Equal counts have equal popularity; otherwise span the full album range.
  if (maximum <= minimum) return 5;
  return Math.max(1, Math.min(5, 1 + Math.round((count - minimum) / (maximum - minimum) * 4)));
}
