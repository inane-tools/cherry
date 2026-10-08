// Accent theming.
//
// Two sources: the current track's artwork (the default, like many players) or
// a fixed custom colour the user picks. The choice lives in settings and is
// pushed here by `services/appearance.ts`; the player only themes from artwork
// while the source is 'song'.
//
// The artwork image is fetched through the Rust relay (`http_proxy_fetch_base64`)
// rather than assigned directly to an <img>, because drawing a cross-origin image
// to a canvas taints it and makes `getImageData` throw. The colour maths lives in
// `themeColor.ts`.

import { isTauri } from './platform';
import { dominantColour, fromHex, toHex, vividify, type Rgb } from './themeColor';

const DEFAULT_PAIR = {
  accent: { r: 255, g: 77, b: 94 } as Rgb,
  accent2: { r: 255, g: 138, b: 92 } as Rgb,
};

/**
 * 'song' = follow the album art (default); 'custom' = a fixed colour set by the
 * user. `setAccentSource` is called by `appearance.ts` when settings change.
 */
let accentSource: 'song' | 'custom' = 'song';
export function setAccentSource(source: 'song' | 'custom'): void {
  accentSource = source;
}

/**
 * The accent is a *fill* colour, so the same value that looks right on the
 * near-black theme reads too heavy on the light one. Track the theme here and
 * lighten the accent toward white when in light mode.
 */
let lightMode = false;
let current = { accent: DEFAULT_PAIR.accent, accent2: DEFAULT_PAIR.accent2 };

const cache = new Map<string, Rgb | null>();
/** Bounded so a long listening session can't grow this without limit. */
const CACHE_MAX = 40;

function remember(artworkUrl: string, colour: Rgb | null): void {
  cache.set(artworkUrl, colour);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Mix a colour toward white. */
function lighten(c: Rgb, amount: number): Rgb {
  return {
    r: c.r + (255 - c.r) * amount,
    g: c.g + (255 - c.g) * amount,
    b: c.b + (255 - c.b) * amount,
  };
}

/** Write the current accent (lightened in light mode) to the CSS variables. */
function applyAccent(): void {
  const root = document.documentElement.style;
  const accent = lightMode ? lighten(current.accent, 0.2) : current.accent;
  const accent2 = lightMode ? lighten(current.accent2, 0.2) : current.accent2;
  root.setProperty('--color-accent', toHex(accent));
  root.setProperty('--color-accent2', toHex(accent2));
}

/** Called by `appearance.ts` when the light/dark theme changes. */
export function setLightMode(on: boolean): void {
  if (lightMode === on) return;
  lightMode = on;
  applyAccent();
}

/** Set the accent (and its lighter companion) from an RGB colour. */
function setAccent(colour: Rgb, vivid: boolean): void {
  const base = vivid ? vividify(colour) : colour;
  current = {
    accent: base,
    accent2: {
      r: Math.min(255, base.r * 1.25 + 30),
      g: Math.min(255, base.g * 1.25 + 30),
      b: Math.min(255, base.b * 1.25 + 30),
    },
  };
  applyAccent();
}

/** Reset to the built-in accent (only meaningful while following the artwork). */
export function resetArtworkTheme(): void {
  if (accentSource !== 'song') return;
  current = { accent: DEFAULT_PAIR.accent, accent2: DEFAULT_PAIR.accent2 };
  applyAccent();
}

/** Apply a fixed custom accent colour (hex). */
export function applyCustomAccent(hex: string): void {
  setAccent(fromHex(hex) ?? DEFAULT_PAIR.accent, false);
}

/** Adopt the dominant colour of `artworkUrl` as the app accent. */
export async function applyArtworkTheme(artworkUrl: string): Promise<void> {
  if (accentSource !== 'song') return;
  if (!artworkUrl || !isTauri()) {
    resetArtworkTheme();
    return;
  }
  if (cache.has(artworkUrl)) {
    const cached = cache.get(artworkUrl);
    if (cached) setAccent(cached, true);
    else resetArtworkTheme();
    return;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const base64 = await invoke<string>('http_proxy_fetch_base64', { url: artworkUrl });
    if (!base64) throw new Error('empty artwork');

    const image = new Image();
    image.src = `data:image/jpeg;base64,${base64}`;
    await image.decode();

    const size = 24;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('no 2d context');
    context.drawImage(image, 0, 0, size, size);
    const { data } = context.getImageData(0, 0, size, size);

    const colour = dominantColour(data);
    remember(artworkUrl, colour);
    if (colour) setAccent(colour, true);
    else resetArtworkTheme();
  } catch (e) {
    // Artwork may be unavailable or undecodable; the default theme still works.
    // eslint-disable-next-line no-console
    console.warn('[cherry] could not theme from artwork:', e);
    remember(artworkUrl, null);
    resetArtworkTheme();
  }
}
