// Pure colour math for album-art theming (no DOM), so it can be unit tested.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hueOf({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let hue: number;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  return (hue * 60 + 360) % 360;
}

export function saturation({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

export function luminance({ r, g, b }: Rgb): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Pick a representative colour from RGBA pixel data.
 *
 * Pixels are bucketed by hue and weighted by saturation, which avoids the
 * common failure where averaging everything returns a muddy grey. Near-black,
 * near-white and washed-out pixels are ignored.
 */
export function dominantColour(data: Uint8ClampedArray): Rgb | null {
  const buckets = new Map<number, { r: number; g: number; b: number; weight: number }>();

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const pixel: Rgb = { r: data[i], g: data[i + 1], b: data[i + 2] };
    const sat = saturation(pixel);
    const lum = luminance(pixel);
    if (lum < 0.08 || lum > 0.92 || sat < 0.18) continue;

    const bucket = Math.round(hueOf(pixel) / 24) * 24;
    const weight = sat * (1 - Math.abs(lum - 0.5));
    const current = buckets.get(bucket) ?? { r: 0, g: 0, b: 0, weight: 0 };
    current.r += pixel.r * weight;
    current.g += pixel.g * weight;
    current.b += pixel.b * weight;
    current.weight += weight;
    buckets.set(bucket, current);
  }

  let best: { r: number; g: number; b: number; weight: number } | null = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.weight > best.weight) best = bucket;
  }
  if (!best || best.weight === 0) return null;
  return { r: best.r / best.weight, g: best.g / best.weight, b: best.b / best.weight };
}

/** Clamp into the useful range for an accent on a near-black UI. */
export function vividify({ r, g, b }: Rgb): Rgb {
  const clamp = (n: number, min: number) => Math.max(min, Math.min(255, n));
  return {
    r: clamp(r * 1.15, 90),
    g: clamp(g * 1.15, 40),
    b: clamp(b * 1.15, 40),
  };
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}
