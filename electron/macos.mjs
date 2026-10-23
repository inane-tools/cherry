// Cocoa coordinates do not scale with the renderer. Center the 14px native
// controls within the shared 48 CSS-pixel topbar at the current app zoom.
export function macTrafficLightPosition(scale) {
  return { x: 14, y: Math.round((48 * scale - 14) / 2) };
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
