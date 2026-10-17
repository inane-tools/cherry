// Chromium manages its own background working set. WebView-specific trimming
// has no Electron equivalent and must not force GC during playback.
export async function startMemoryTrimming(): Promise<() => void> { return () => {}; }
