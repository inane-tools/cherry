// Album-art driven theming.
//
// The accent and background wash follow the current track's artwork, the way
// many music players do it. The image is fetched through the Rust relay
// (`http_proxy_fetch_base64`) rather than assigned directly to an <img>,
// because drawing a cross-origin image to a canvas taints it and makes
// `getImageData` throw. The colour maths lives in `themeColor.ts`.

import { isTauri } from './platform';
import { dominantColour, toHex, vividify, type Rgb } from './themeColor';

const DEFAULTS = {
  accent: '#ff4d5e',
  accent2: '#ff8a5c',
};

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

function applyTheme(accent: Rgb): void {
  const vivid = vividify(accent);
  const lighter: Rgb = {
    r: Math.min(255, vivid.r * 1.25 + 30),
    g: Math.min(255, vivid.g * 1.25 + 30),
    b: Math.min(255, vivid.b * 1.25 + 30),
  };
  // Only colours are set: `--color-accent` is registered with @property so the
  // change animates, and the wash derives from it via color-mix.
  const root = document.documentElement.style;
  root.setProperty('--color-accent', toHex(vivid));
  root.setProperty('--color-accent2', toHex(lighter));
}

export function resetArtworkTheme(): void {
  const root = document.documentElement.style;
  root.setProperty('--color-accent', DEFAULTS.accent);
  root.setProperty('--color-accent2', DEFAULTS.accent2);
}

/** Adopt the dominant colour of `artworkUrl` as the app accent. */
export async function applyArtworkTheme(artworkUrl: string): Promise<void> {
  if (!artworkUrl || !isTauri()) {
    resetArtworkTheme();
    return;
  }
  if (cache.has(artworkUrl)) {
    const cached = cache.get(artworkUrl);
    if (cached) applyTheme(cached);
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
    if (colour) applyTheme(colour);
    else resetArtworkTheme();
  } catch (e) {
    // Artwork may be unavailable or undecodable; the default theme still works.
    // eslint-disable-next-line no-console
    console.warn('[cherry] could not theme from artwork:', e);
    remember(artworkUrl, null);
    resetArtworkTheme();
  }
}
