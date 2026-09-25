//! OS media controls: SMTC (Windows), MPRIS (Linux), Now Playing (macOS)
//! via the `souvlaki` crate. Key presses are forwarded to the frontend as
//! `media-key://…` events; the frontend pushes track metadata back down.
//!
//! ## On the Windows "unknown app" entry
//!
//! SMTC sessions are owned by the *process*, and the name/icon Windows shows
//! come from the app's **AppUserModelID registration** (i.e. the installed
//! shortcut / `AppUserModelId` on the window), not from anything souvlaki can
//! set. A debug build launched straight from `target\debug` has no registered
//! identity, so Windows labels the session "Unknown app". Two entries appear
//! because there are genuinely two SMTC sessions for this process: the one we
//! create in `setup` (correct metadata/controls) and a second, earlier one the
//! WebView2 runtime creates for its own audio — Windows surfaces both.
//!
//! The fix is therefore an **app-identity** fix, applied here:
//!  - the window's `AppUserModelID` is set to the bundle identifier, and
//!  - the SMTC display updater is told the app name explicitly.
//! The installed build (NSIS/MSI) registers the shortcut identity, so a
//! packaged Cherry shows as "Cherry" with the Cherry icon.

use serde::Deserialize;
use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
    SeekDirection,
};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

/// The app name Windows shows on the media card / taskbar preview.
pub const APP_NAME: &str = "Cherry";

pub struct MediaState(pub Mutex<Option<MediaControls>>);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    #[serde(default)]
    pub album: String,
    #[serde(default)]
    pub artwork: String,
    #[serde(default)]
    pub duration_secs: i64,
    /// Current position — the SMTC/taskbar preview and the Action Center media
    /// card render their scrubber from this.
    #[serde(default)]
    pub position_secs: i64,
    pub is_playing: bool,
}

fn emit(app: &AppHandle, event: &str) {
    let _ = app.emit(event, ());
}

/// Register the window with the bundle identifier as its AppUserModelID.
///
/// This is what Windows reads the media card's app name/icon from. Without it,
/// a session is labelled "Unknown app". Setting it at runtime fixes the
/// un-packaged (dev) case; a packaged build also gets it from the installed
/// shortcut, so this is harmless there.
#[cfg(target_os = "windows")]
fn set_app_user_model_id(hwnd: isize) {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;

    // Process-wide; the HWND argument is only used to keep this call tied to
    // the window we are about to bind SMTC to (and to make the intent clear).
    let _ = hwnd;
    let id = HSTRING::from("com.cherry.app");
    unsafe {
        let _ = SetCurrentProcessExplicitAppUserModelID(&id);
    }
}

pub fn init_media_controls(app: &AppHandle) -> Result<(), String> {
    let handle = app.clone();

    // SMTC on Windows must be bound to a real window handle (souvlaki
    // panics on `hwnd: None`). The config-defined "main" window already
    // exists by the time `setup` runs, so its HWND is valid here.
    #[cfg(target_os = "windows")]
    let hwnd: Option<*mut std::ffi::c_void> = {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "main window not created yet".to_string())?;
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        set_app_user_model_id(hwnd.0 as isize);
        Some(hwnd.0 as *mut std::ffi::c_void)
    };
    #[cfg(not(target_os = "windows"))]
    let hwnd: Option<*mut std::ffi::c_void> = None;

    let mut controls = MediaControls::new(PlatformConfig {
        dbus_name: "cherry",
        display_name: APP_NAME,
        hwnd,
    })
    .map_err(|e| e.to_string())?;

    controls
        .attach(move |event| match event {
            MediaControlEvent::Play | MediaControlEvent::Toggle => {
                emit(&handle, "media-key://playpause")
            }
            MediaControlEvent::Pause | MediaControlEvent::Stop => {
                emit(&handle, "media-key://pause")
            }
            MediaControlEvent::Next => emit(&handle, "media-key://next"),
            MediaControlEvent::Previous => emit(&handle, "media-key://prev"),
            // Scrubber on the Action Center card / taskbar preview.
            MediaControlEvent::SetPosition(MediaPosition(position)) => {
                let _ = handle.emit(
                    "media-key://seek",
                    serde_json::json!({ "positionSecs": position.as_secs() as i64 }),
                );
            }
            MediaControlEvent::Seek(direction) => {
                let delta = match direction {
                    SeekDirection::Forward => 10,
                    SeekDirection::Backward => -10,
                };
                let _ = handle.emit("media-key://seek-by", serde_json::json!({ "deltaSecs": delta }));
            }
            MediaControlEvent::SeekBy(direction, amount) => {
                let secs = amount.as_secs() as i64;
                let delta = match direction {
                    SeekDirection::Forward => secs,
                    SeekDirection::Backward => -secs,
                };
                let _ = handle.emit("media-key://seek-by", serde_json::json!({ "deltaSecs": delta }));
            }
            MediaControlEvent::SetVolume(volume) => {
                let _ = handle.emit("media-key://volume", serde_json::json!({ "volume": volume }));
            }
            MediaControlEvent::Raise => {
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            _ => {}
        })
        .map_err(|e| e.to_string())?;

    if let Some(state) = app.try_state::<MediaState>() {
        *state.0.lock().map_err(|e| e.to_string())? = Some(controls);
    }
    Ok(())
}

#[tauri::command]
pub fn media_now_playing(state: State<MediaState>, info: NowPlaying) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let Some(controls) = guard.as_mut() else {
        return Ok(());
    };
    let mut meta = MediaMetadata::default();
    meta.title = Some(info.title.as_str());
    meta.artist = Some(info.artist.as_str());
    if !info.album.is_empty() {
        meta.album = Some(info.album.as_str());
    }
    if !info.artwork.is_empty() {
        meta.cover_url = Some(info.artwork.as_str());
    }
    if info.duration_secs > 0 {
        meta.duration = Some(Duration::from_secs(info.duration_secs as u64));
    }
    controls.set_metadata(meta).map_err(|e| e.to_string())?;
    // A position (not just a duration) is what makes the SMTC render a real
    // scrubber in the taskbar preview and the Action Center media card.
    let position = Duration::from_secs(info.position_secs.max(0) as u64);
    controls
        .set_playback(if info.is_playing {
            MediaPlayback::Playing {
                progress: Some(MediaPosition(position)),
            }
        } else {
            MediaPlayback::Paused {
                progress: Some(MediaPosition(position)),
            }
        })
        .map_err(|e| e.to_string())?;

    // Keep the taskbar thumbnail toolbar's play/pause button in sync.
    #[cfg(target_os = "windows")]
    crate::thumbar::set_playing(info.is_playing);
    Ok(())
}

#[tauri::command]
pub fn media_cleared(state: State<MediaState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(controls) = guard.as_mut() {
        controls
            .set_playback(MediaPlayback::Stopped)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frontend payload must carry the live position: the SMTC scrubber in
    /// the taskbar preview and the Action Center card is rendered from it, and
    /// a missing/renamed field would silently leave it stuck at zero.
    #[test]
    fn now_playing_payload_carries_position() {
        let info: NowPlaying = serde_json::from_str(
            r#"{"title":"Song","artist":"Artist","album":"Album","artwork":"https://x/y.jpg","durationSecs":200,"positionSecs":42,"isPlaying":true}"#,
        )
        .expect("payload should deserialize");
        assert_eq!(info.position_secs, 42);
        assert_eq!(info.duration_secs, 200);
        assert_eq!(info.artwork, "https://x/y.jpg");
        assert!(info.is_playing);
    }

    /// `positionSecs` is optional so older payloads still work.
    #[test]
    fn now_playing_position_is_optional() {
        let info: NowPlaying =
            serde_json::from_str(r#"{"title":"T","artist":"A","isPlaying":false}"#).unwrap();
        assert_eq!(info.position_secs, 0);
    }
}
