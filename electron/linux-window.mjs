import { windowChrome } from './macos.mjs';

/** Recreate only Linux's native frame; keep the renderer and playback alive. */
export function createLinuxWindow({ BaseWindow, WebContentsView, options, controlsVisible, onCreated }) {
  const { webPreferences, ...windowOptions } = options;
  const view = new WebContentsView({ webPreferences });
  view.setBackgroundColor(options.backgroundColor);
  let current;
  let visible;

  function setVisible(next) {
    if (current && next === visible) return;
    const previous = current;
    const replacement = new BaseWindow({
      ...windowOptions,
      ...(previous ? previous.getNormalBounds() : {}),
      ...windowChrome('linux', next),
      roundedCorners: true,
      show: false,
    });
    // These adapters let the shared host keep using its BrowserWindow contract.
    Object.defineProperty(replacement, 'webContents', { value: view.webContents });
    replacement.loadURL = url => view.webContents.loadURL(url);
    const sizeView = () => {
      if (current !== replacement || replacement.isDestroyed()) return;
      const [width, height] = replacement.getContentSize();
      view.setBounds({ x: 0, y: 0, width, height });
      // BrowserWindow clips its primary view for CSD; BaseWindow does not.
      // Clip in native DIPs so app zoom cannot change the window's corners.
      view.setBorderRadius(replacement.isMaximized() || replacement.isFullScreen() ? 0 : 12);
    };
    previous?.contentView.removeChildView(view);
    replacement.contentView.addChildView(view);
    current = replacement;
    visible = next;
    replacement.setMenuBarVisibility(false);
    for (const event of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
      replacement.on(event, sizeView);
    }
    replacement.on('closed', () => {
      if (current === replacement && !view.webContents.isDestroyed()) view.webContents.close();
    });
    sizeView();
    onCreated(replacement, next);
    if (previous) {
      if (previous.isMaximized()) replacement.maximize();
      if (previous.isFullScreen()) replacement.setFullScreen(true);
      if (previous.isAlwaysOnTop()) replacement.setAlwaysOnTop(true);
      if (previous.isVisible()) {
        if (previous.isFocused()) { replacement.show(); replacement.focus(); }
        else replacement.showInactive();
      }
      if (previous.isMinimized()) replacement.minimize();
      previous.destroy();
    }
  }
  setVisible(controlsVisible);
  return { setVisible };
}
