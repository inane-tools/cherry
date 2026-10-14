use crate::tray_menu::Shortcut;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{Emitter, Manager};

pub struct PlaylistLaunch {
    pending: Mutex<Option<String>>,
    ready: AtomicBool,
}

pub fn playlist_argument(args: &[String]) -> Option<String> {
    args.windows(2).find_map(|pair| {
        let id = &pair[1];
        (pair[0] == "--play-playlist"
            && !id.is_empty()
            && id.len() <= 256
            && id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-'))
        .then(|| id.clone())
    })
}

impl Default for PlaylistLaunch {
    fn default() -> Self {
        Self {
            pending: Mutex::new(playlist_argument(&std::env::args().collect::<Vec<_>>())),
            ready: AtomicBool::new(false),
        }
    }
}

pub fn dispatch(app: &tauri::AppHandle, id: String) {
    let state = app.state::<PlaylistLaunch>();
    // Holding the lock closes the startup gap between draining and listening.
    if let Ok(mut pending) = state.pending.lock() {
        if state.ready.load(Ordering::Acquire) {
            let _ = app.emit("tray://action", format!("playlist:{id}"));
        } else {
            *pending = Some(id);
        }
    };
}

#[tauri::command]
pub fn take_playlist_launch(state: tauri::State<'_, PlaylistLaunch>) -> Option<String> {
    let mut pending = state.pending.lock().ok()?;
    state.ready.store(true, Ordering::Release);
    pending.take()
}

#[tauri::command]
pub async fn update_jump_list(
    app: tauri::AppHandle,
    pinned: Vec<Shortcut>,
    recent: Vec<Shortcut>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return tokio::task::spawn_blocking(move || windows_list(&app, &pinned, &recent))
        .await
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, pinned, recent);
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn windows_list(
    app: &tauri::AppHandle,
    pinned: &[Shortcut],
    recent: &[Shortcut],
) -> Result<(), String> {
    use windows::{
        core::{Interface, GUID, HSTRING},
        Win32::{
            Foundation::PROPERTYKEY,
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, StructuredStorage::PROPVARIANT,
                CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
            },
            UI::Shell::{
                Common::{IObjectArray, IObjectCollection},
                DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW,
                PropertiesSystem::IPropertyStore,
                ShellLink,
            },
        },
    };
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| e.to_string())?;
        struct ComGuard;
        impl Drop for ComGuard {
            fn drop(&mut self) {
                unsafe {
                    CoUninitialize();
                }
            }
        }
        let _com = ComGuard;
        let result = (|| -> windows::core::Result<()> {
            let list: ICustomDestinationList =
                CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)?;
            list.SetAppID(&HSTRING::from("com.cherry.app"))?;
            let mut slots = 0;
            let removed: IObjectArray = list.BeginList(&mut slots)?;
            let build = (|| -> windows::core::Result<()> {
                let mut removed_ids = std::collections::HashSet::new();
                for i in 0..removed.GetCount()? {
                    if let Ok(link) = removed.GetAt::<IShellLinkW>(i) {
                        let mut buffer = [0u16; 1024];
                        if link.GetArguments(&mut buffer).is_ok() {
                            let args = String::from_utf16_lossy(
                                &buffer
                                    [..buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len())],
                            );
                            if let Some(id) = playlist_argument(
                                &args
                                    .split_whitespace()
                                    .map(str::to_string)
                                    .collect::<Vec<_>>(),
                            ) {
                                removed_ids.insert(id);
                            }
                        }
                    }
                }
                let executable =
                    std::env::current_exe().map_err(|_| windows::core::Error::from_win32())?;
                let executable = HSTRING::from(executable.to_string_lossy().as_ref());
                let title_key = PROPERTYKEY {
                    fmtid: GUID::from_u128(0xf29f85e0_4ff9_1068_ab91_08002b27b3d9),
                    pid: 2,
                };
                let mut used = std::collections::HashSet::new();
                let mut remaining = slots as usize;
                for (heading, shortcuts) in
                    [("Pinned playlists", pinned), ("Recent playlists", recent)]
                {
                    let collection: IObjectCollection =
                        CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
                    for shortcut in shortcuts {
                        if remaining == 0 {
                            break;
                        }
                        let args = vec!["--play-playlist".to_string(), shortcut.browse_id.clone()];
                        if playlist_argument(&args).is_none()
                            || removed_ids.contains(&shortcut.browse_id)
                            || !used.insert(shortcut.browse_id.clone())
                        {
                            continue;
                        }
                        let link: IShellLinkW =
                            CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
                        link.SetPath(&executable)?;
                        let icon =
                            icon_path(app, &shortcut.thumbnail).filter(|path| path.is_file());
                        let icon = icon
                            .map(|path| HSTRING::from(path.to_string_lossy().as_ref()))
                            .unwrap_or_else(|| executable.clone());
                        link.SetIconLocation(&icon, 0)?;
                        link.SetArguments(&HSTRING::from(format!(
                            "--play-playlist {}",
                            shortcut.browse_id
                        )))?;
                        link.SetDescription(&HSTRING::from(format!(
                            "Play {} in Cherry",
                            shortcut.title
                        )))?;
                        let properties: IPropertyStore = link.cast()?;
                        properties
                            .SetValue(&title_key, &PROPVARIANT::from(shortcut.title.as_str()))?;
                        properties.Commit()?;
                        collection.AddObject(&link)?;
                        remaining -= 1;
                    }
                    let objects: IObjectArray = collection.cast()?;
                    if objects.GetCount()? > 0 {
                        list.AppendCategory(&HSTRING::from(heading), &objects)?;
                    }
                }
                list.CommitList()
            })();
            if build.is_err() {
                let _ = list.AbortList();
            }
            build
        })();
        result.map_err(|e| e.to_string())
    }
}

fn icon_path(app: &tauri::AppHandle, thumbnail: &str) -> Option<std::path::PathBuf> {
    if thumbnail.is_empty() {
        return None;
    }
    Some(
        app.path()
            .app_cache_dir()
            .ok()?
            .join("jump-list-icons")
            .join(format!("{:x}.ico", md5::compute(thumbnail))),
    )
}

#[tauri::command]
pub fn jump_artwork_cached(app: tauri::AppHandle, thumbnail: String) -> bool {
    icon_path(&app, &thumbnail).is_some_and(|path| path.is_file())
}

fn png_icon(png: &[u8]) -> Result<Vec<u8>, String> {
    if png.len() > 65_536
        || png.len() < 24
        || &png[..8] != b"\x89PNG\r\n\x1a\n"
        || &png[12..16] != b"IHDR"
        || png[16..20] != 64u32.to_be_bytes()
        || png[20..24] != 64u32.to_be_bytes()
    {
        return Err("Expected a 64-pixel PNG thumbnail".into());
    }
    tauri::image::Image::from_bytes(png).map_err(|e| e.to_string())?;
    let mut ico = vec![0, 0, 1, 0, 1, 0, 64, 64, 0, 0, 1, 0, 32, 0];
    ico.extend_from_slice(&(png.len() as u32).to_le_bytes());
    ico.extend_from_slice(&22u32.to_le_bytes());
    ico.extend_from_slice(png);
    Ok(ico)
}

#[tauri::command]
pub async fn cache_jump_artwork(
    app: tauri::AppHandle,
    thumbnail: String,
    png_base64: String,
) -> Result<(), String> {
    use base64::Engine;
    if png_base64.len() > 90_000 {
        return Err("Artwork too large".into());
    }
    tokio::task::spawn_blocking(move || {
        let path = icon_path(&app, &thumbnail).ok_or("Artwork cache unavailable")?;
        let png = base64::engine::general_purpose::STANDARD
            .decode(png_base64)
            .map_err(|e| e.to_string())?;
        let icon = png_icon(&png)?;
        std::fs::create_dir_all(path.parent().ok_or("Artwork cache unavailable")?)
            .map_err(|e| e.to_string())?;
        std::fs::write(path, icon).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn artwork_icon_is_decodable_and_rejects_invalid_images() {
        let ico = png_icon(include_bytes!("../icons/64x64.png")).unwrap();
        let decoded = tauri::image::Image::from_bytes(&ico).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (64, 64));
        assert!(png_icon(b"not an image").is_err());
        assert!(png_icon(include_bytes!("../icons/128x128.png")).is_err());
    }
    #[test]
    fn parses_only_safe_playlist_arguments() {
        assert_eq!(
            playlist_argument(&[
                "cherry".into(),
                "--play-playlist".into(),
                "VLPL_abc-123".into()
            ]),
            Some("VLPL_abc-123".into())
        );
        for id in ["", "abc\" --quit", "https://example.org", "../file"] {
            assert_eq!(
                playlist_argument(&["--play-playlist".into(), id.into()]),
                None
            );
        }
        assert_eq!(playlist_argument(&["--play-playlist".into()]), None);
    }
}
