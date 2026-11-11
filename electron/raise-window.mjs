// Bring the main window to the front. `show()` alone does not un-minimize a
// window on Windows or Linux, so a minimized window is restored first.
export function raiseWindow(window) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
