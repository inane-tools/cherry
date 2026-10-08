// UI zoom: scales the whole window like browser zoom, using WebView2's native
// zoom factor (via the `set_webview_zoom` Rust command) rather than a CSS
// transform, so fixed-position chrome and the overlay scrollbar stay correct.
//
// The level lives in settings; this module is the single place that pushes it
// to the webview.

import { invokeSafe } from './platform';
import { settingsStore } from './settings';

/** Allowed zoom range (shared with the Settings slider). */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.1;

/** Every selectable level, for the slider's visible step markers. */
export const ZOOM_STEPS: number[] = Array.from(
  { length: Math.round((ZOOM_MAX - ZOOM_MIN) / ZOOM_STEP) + 1 },
  (_, i) => ZOOM_MIN + i * ZOOM_STEP,
);

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

/** Percentage of the zoom slider's track that should be filled. */
export function zoomFillPercent(value: number): number {
  return ((clampZoom(value) - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100;
}

let applied = -1;

/** Apply a zoom level to the current (main) webview. */
export function applyZoom(scale: number): void {
  const next = clampZoom(scale);
  if (next === applied) return;
  applied = next;
  void invokeSafe('set_webview_zoom', { scale: next });
}

let started = false;
/** Begin mirroring the stored zoom onto the webview. Safe to call once. */
export function startZoom(): void {
  if (started) return;
  started = true;
  settingsStore.subscribe((s) => applyZoom(s.uiZoom ?? 1));
}
