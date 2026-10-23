import { invoke } from '$lib/desktop/core';
export function isDesktop(): boolean { return typeof window !== 'undefined' && !!window.cherryDesktop; }
export function isMacDesktop(): boolean { return isDesktop() && /Macintosh|Mac OS X/.test(navigator.userAgent); }
export async function invokeSafe<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isDesktop()) return null;
  try { return await invoke<T>(command, args); } catch { return null; }
}
export async function invokeStrict<T>(command: string, args?: Record<string, unknown>, desktopOnly = 'Desktop only.'): Promise<T> {
  if (!isDesktop()) throw new Error(desktopOnly);
  return invoke<T>(command, args);
}
export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return fallback;
}
