//! Developer tools (WebView DevTools).
//!
//! `WebviewWindow::open_devtools` is only compiled in debug builds unless the
//! `tauri` crate's `devtools` feature is enabled (it is, see Cargo.toml), so
//! these commands make the DevTools reachable from a packaged build too — the
//! Settings → Developer section is the only way in.
//!
//! The commands are thin wrappers so the frontend never needs the
//! `core:webview:allow-open-devtools` capability (custom commands are always
//! allowed), and so a non-Tauri browser build can simply no-op.

use tauri::Manager;

#[tauri::command]
pub fn open_devtools(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window.open_devtools();
    }
}
