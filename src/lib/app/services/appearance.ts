// Appearance: theme (system/light/dark) and accent source, applied from settings.
//
// The whole UI is styled with Tailwind colour utilities that resolve to
// `var(--color-*)` (verified in the built CSS), so switching theme is just a
// class on <html> plus overrides of those tokens — see the `html.light` block in
// `app.css`. This module is the single place that reads the appearance settings
// and pushes them to the DOM.

import { get } from 'svelte/store';
import type { CherrySettings } from '$lib/infra/storage/settingsRepo';
import { bestThumbnail } from '$lib/core/models';
import { playerStore } from './player';
import { settingsStore } from './settings';
import {
  applyArtworkTheme,
  applyCustomAccent,
  resetArtworkTheme,
  setAccentSource,
  setLightMode,
  setTinted,
} from './theme';

const media =
  typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function effectiveTheme(settings: CherrySettings): 'light' | 'dark' {
  if (settings.theme === 'light' || settings.theme === 'dark') return settings.theme;
  return media?.matches ? 'dark' : 'light';
}

function applyThemeClass(theme: 'light' | 'dark'): void {
  document.documentElement.classList.toggle('light', theme === 'light');
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

// Only touch the DOM when something actually changed: the settings store also
// emits for volume, queue and everything else.
let lastTheme: 'light' | 'dark' | null = null;
let lastSource: CherrySettings['accentSource'] | null = null;
let lastColour: string | null = null;
let lastGradients: boolean | null = null;
let lastTinted: boolean | null = null;

function apply(settings: CherrySettings): void {
  if (typeof document === 'undefined') return;

  const theme = effectiveTheme(settings);
  if (theme !== lastTheme) {
    applyThemeClass(theme);
    // Accents are lightened in light mode (theme.ts), so it needs to know.
    setLightMode(theme === 'light');
    lastTheme = theme;
  }

  if (settings.gradientsEnabled !== lastGradients) {
    document.documentElement.classList.toggle('no-gradients', !settings.gradientsEnabled);
    lastGradients = settings.gradientsEnabled;
  }

  if (settings.tintedBackground !== lastTinted) {
    setTinted(settings.tintedBackground);
    lastTinted = settings.tintedBackground;
  }

  if (settings.accentSource === 'custom') {
    setAccentSource('custom');
    // Re-apply when returning from 'song' too: the artwork accent may have
    // overwritten the fixed colour even though the hex string is unchanged.
    if (settings.accentColor !== lastColour || lastSource !== 'custom') {
      applyCustomAccent(settings.accentColor);
      lastColour = settings.accentColor;
    }
    lastSource = 'custom';
    return;
  }

  setAccentSource('song');
  if (lastSource !== 'song') {
    // Switched back to artwork-driven: re-derive from the current track, or the
    // built-in accent until one plays.
    const track = get(playerStore).track;
    if (track) void applyArtworkTheme(bestThumbnail(track.thumbnails, 256));
    else resetArtworkTheme();
  }
  lastSource = 'song';
}

let started = false;
/** Begin applying appearance settings. Safe to call once at startup. */
export function startAppearance(): void {
  if (started) return;
  started = true;
  settingsStore.subscribe(apply);
  media?.addEventListener('change', () => apply(get(settingsStore)));
}
