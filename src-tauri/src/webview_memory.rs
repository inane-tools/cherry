//! Trim WebView2's memory while the window is not in use.
//!
//! Chromium keeps its whole working set alive even when the window is hidden to
//! the tray, which is why an idle Cherry can sit at a few hundred MB. WebView2
//! exposes `MemoryUsageTargetLevel`: in the `Low` state it releases caches
//! aggressively, and switching back to `Normal` on focus keeps the UI snappy.
//! So the app trims when it loses focus and restores the moment it is used
//! again — interactive performance is never sacrificed.

use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn set_webview_memory_low(app: AppHandle, low: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    window
        .with_webview(move |webview| {
            #[cfg(target_os = "windows")]
            {
                use webview2_com::Microsoft::Web::WebView2::Win32::{
                    ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
                };
                use windows::core::Interface;

                // SAFETY: `with_webview` runs the closure on the UI thread and
                // the COM interfaces are valid for its duration.
                let controller = webview.controller();
                let core = match unsafe { controller.CoreWebView2() } {
                    Ok(core) => core,
                    Err(_) => return,
                };
                // `ICoreWebView2_19` only exists on newer runtimes; if it is not
                // available there is simply nothing to trim.
                let Ok(core19) = core.cast::<ICoreWebView2_19>() else {
                    return;
                };
                let level = if low {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                } else {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                };
                let _ = unsafe { core19.SetMemoryUsageTargetLevel(level) };
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = (webview, low);
            }
        })
        .map_err(|e| e.to_string())
}
