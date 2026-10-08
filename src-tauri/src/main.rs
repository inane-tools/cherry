#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth_store;
mod devtools;
mod discord;
mod http_proxy;
mod lastfm;
mod maintenance;
mod media_controls;
mod migrate;
mod playlist_image;
mod secrets;
mod thumbar;
mod webview_memory;
mod ytm_login;

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

fn build_tray(app: &tauri::AppHandle) {
    let show = MenuItem::with_id(app, "show", "Show Cherry", true, None::<&str>);
    let toggle = MenuItem::with_id(app, "toggle", "Play / Pause", true, None::<&str>);
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>);
    let (Ok(show), Ok(toggle), Ok(quit)) = (show, toggle, quit) else {
        return;
    };
    let Ok(menu) = Menu::with_items(app, &[&show, &toggle, &quit]) else {
        return;
    };
    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Cherry")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "toggle" => {
                let _ = app.emit("media-key://playpause", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { .. } = event {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    let _ = builder.build(app);
}

/// Append extra browser arguments for WebView2, preserving any the user set.
///
/// Must run before the first webview exists. Tauri's per-window
/// `additionalBrowserArgs` config is ignored because it shares one WebView2
/// environment (WebContext) across webviews, but this environment variable is
/// appended to the browser's arguments.
fn append_webview2_args(extra: &str) {
    const KEY: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
    let existing = std::env::var(KEY).unwrap_or_default();
    let merged = format!("{existing} {extra}").trim().to_string();
    std::env::set_var(KEY, merged);
}

fn main() {
    // Browser arguments for every WebView2 webview.
    //
    // These MUST go through the environment variable, not the window config's
    // `additionalBrowserArgs`: that field sets the shared WebView2 environment
    // (so it leaks into the login window) and breaks it — see the warning at the
    // top of `ytm_login.rs`. The env var is applied before any webview exists and
    // is the path the working sign-in relied on.
    //
    // - `--disable-media-session-api` / `MediaSessionService`: Chromium registers
    //   its own media session for the <audio> element, which Windows surfaces in
    //   the media flyout as a second, metadata-less "Cherry" entry beside the one
    //   we drive through souvlaki. Disabling it leaves only our session.
    // - `HardwareMediaKeyHandling`: let the global-shortcut handler own the media
    //   keys instead of the webview swallowing them.
    // - `msWebOOUI` / `msPdfOOUI` / `msSmartScreenProtection`: drop Edge's
    //   Office/PDF/SmartScreen UI from an app that renders none of it.
    // - `--autoplay-policy=no-user-gesture-required`: resume playback without a
    //   click after a restart.
    append_webview2_args(
        "--disable-media-session-api \
         --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,MediaSessionService,HardwareMediaKeyHandling \
         --autoplay-policy=no-user-gesture-required",
    );

    // Before anything reads (or creates) app data: carry over anything stored
    // under the app's previous identity, and finish any clear the running app
    // had to defer because WebView2 held its profile open.
    migrate::run();
    maintenance::run_startup_cleanup();
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(media_controls::MediaState(Mutex::new(None)))
        .manage(discord::DiscordState::default())
        .setup(|app| {
            if let Err(e) = media_controls::init_media_controls(app.handle()) {
                eprintln!("[cherry] media controls unavailable: {e}");
            }
            // Taskbar thumbnail-preview media buttons (Windows only; no-op
            // elsewhere).
            #[cfg(target_os = "windows")]
            if let Err(e) = thumbar::install(&app.handle()) {
                eprintln!("[cherry] taskbar media buttons unavailable: {e}");
            }
            build_tray(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth_store::auth_save,
            auth_store::auth_load,
            auth_store::auth_clear,
            ytm_login::open_ytm_login,
            ytm_login::close_ytm_login,
            ytm_login::ytm_login_status,
            ytm_login::ytm_login_finish,
            http_proxy::http_proxy_fetch,
            http_proxy::http_proxy_fetch_base64,
            media_controls::media_now_playing,
            media_controls::media_cleared,
            discord::discord_set_app_id,
            discord::discord_status,
            discord::discord_set_presence,
            discord::discord_clear_presence,
            devtools::open_devtools,
            lastfm::lastfm_get_token,
            lastfm::lastfm_get_session,
            lastfm::lastfm_now_playing,
            lastfm::lastfm_scrobble,
            playlist_image::upload_playlist_thumbnail,
            maintenance::cache_size,
            maintenance::clear_local_data,
            secrets::secret_save,
            secrets::secret_load,
            webview_memory::set_webview_memory_low,
        ])
        .on_window_event(|window, event| {
            // Music app behavior: closing the main window minimizes to tray.
            // Quit explicitly from the tray menu. Auxiliary windows
            // (e.g. the login dialog) close normally.
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Cherry");
}
