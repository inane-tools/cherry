// Tiny platform helpers — keep all `window.__TAURI__` sniffing here so
// services stay testable in a plain browser.

export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

export async function invokeSafe<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  } catch {
    return null;
  }
}

/**
 * `invoke` for commands that only exist in the desktop app: rejects with
 * `desktopOnly` in a plain browser, and otherwise propagates the command's
 * error (unlike `invokeSafe`, which swallows it).
 */
export async function invokeStrict<T>(
  cmd: string,
  args?: Record<string, unknown>,
  desktopOnly = 'Desktop only.',
): Promise<T> {
  if (!isTauri()) throw new Error(desktopOnly);
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/**
 * Message from a thrown value. Tauri's `invoke` rejects with the command's
 * `Err(String)` — a plain string, not an `Error` — so `e instanceof Error`
 * alone hides the real reason behind a generic message.
 */
export function errorMessage(e: unknown, fallback = 'Something went wrong.'): string {
  if (typeof e === 'string' && e.trim()) return e;
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return fallback;
}
