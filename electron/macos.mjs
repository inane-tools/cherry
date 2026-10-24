// Cocoa coordinates do not scale with the renderer. Center the 14px native
// controls within the shared 48 CSS-pixel topbar at the current app zoom.
export function macTrafficLightPosition(scale) {
  return { x: 14, y: Math.round((48 * scale - 14) / 2) };
}

/** AppKit can lay out the titlebar again after showing/restoring native buttons. */
export function installMacWindowControls(window) {
  let visible;
  let pending;
  const align = () => {
    if (!window.isDestroyed() && !window.isFullScreen()) {
      window.setWindowButtonPosition(macTrafficLightPosition(window.webContents.getZoomFactor()));
    }
  };
  const schedule = () => {
    if (pending) clearImmediate(pending);
    pending = setImmediate(() => { pending = undefined; align(); });
  };
  const refresh = () => { align(); schedule(); };
  for (const event of ['ready-to-show', 'show', 'focus', 'restore', 'resize', 'leave-full-screen']) {
    window.on(event, schedule);
  }
  window.once('closed', () => { if (pending) clearImmediate(pending); });
  return {
    refresh,
    setVisible(next) {
      // Most settings writes have nothing to do with native chrome. Avoid
      // asking AppKit to rebuild it on every playback/account preference save.
      if (next === visible) return;
      visible = next;
      window.setWindowButtonVisibility(next);
      refresh();
    },
  };
}

/** Keep the native traffic lights on macOS; other hosts use renderer buttons. */
export function windowChrome(platform) {
  return platform === 'darwin'
    ? { frame: true, titleBarStyle: 'hidden', trafficLightPosition: macTrafficLightPosition(1) }
    : { frame: false };
}

/** Explicit roles preserve standard macOS keyboard and application actions. */
export function macMenuTemplate() {
  return [
    { role: 'appMenu' },
    { label: 'File', submenu: [{ role: 'close' }] },
    { id: 'mac-edit-menu', role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ];
}
