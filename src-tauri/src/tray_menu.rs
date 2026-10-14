use serde::Deserialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shortcut {
    pub browse_id: String,
    pub title: String,
    #[serde(default)]
    pub thumbnail: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayState {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub has_track: bool,
    pub playing: bool,
    pub shuffle: bool,
    pub repeat: String,
    pub signed_in: bool,
    pub pinned: Vec<Shortcut>,
}

pub fn label(text: &str) -> String {
    text.replace(['\r', '\n', '\t'], " ")
        .chars()
        .take(120)
        .collect::<String>()
        .replace('&', "&&")
}

pub fn menu(app: &tauri::AppHandle, state: &TrayState) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    let item =
        |id: &str, text: &str, enabled| MenuItem::with_id(app, id, text, enabled, None::<&str>);
    menu.append(&item(
        "song",
        &label(if state.title.is_empty() {
            "Nothing playing"
        } else {
            &state.title
        }),
        false,
    )?)?;
    let details = [state.artist.as_str(), state.album.as_str()]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" · ");
    if !details.is_empty() {
        menu.append(&item("details", &label(&details), false)?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let enabled = state.has_track && state.signed_in;
    menu.append(&item(
        "toggle",
        if state.playing { "Pause" } else { "Play" },
        enabled,
    )?)?;
    for (id, text) in [("prev", "Previous song"), ("next", "Next song")] {
        menu.append(&item(id, text, enabled)?)?;
    }
    menu.append(&CheckMenuItem::with_id(
        app,
        "shuffle",
        "Shuffle",
        enabled,
        state.shuffle,
        None::<&str>,
    )?)?;
    let repeat = Submenu::with_id(app, "repeat", "Repeat", enabled)?;
    for (mode, text) in [
        ("off", "Off"),
        ("all", "All songs"),
        ("one", "Current song"),
    ] {
        repeat.append(&CheckMenuItem::with_id(
            app,
            format!("repeat:{mode}"),
            text,
            true,
            state.repeat == mode,
            None::<&str>,
        )?)?;
    }
    menu.append(&repeat)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let pins = Submenu::with_id(
        app,
        "pinned",
        "Pinned playlists",
        state.signed_in && !state.pinned.is_empty(),
    )?;
    for pin in &state.pinned {
        pins.append(&item(
            &format!("playlist:{}", pin.browse_id),
            &label(&pin.title),
            true,
        )?)?;
    }
    menu.append(&pins)?;
    menu.append(&item("show", "Show Cherry", true)?)?;
    menu.append(&item("quit", "Quit", true)?)?;
    Ok(menu)
}

#[tauri::command]
pub async fn update_tray(app: tauri::AppHandle, state: TrayState) -> Result<(), String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| {
            let tray = handle.tray_by_id("main-tray").ok_or("Tray unavailable")?;
            let menu = menu(&handle, &state).map_err(|e| e.to_string())?;
            tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
            let tooltip = if state.title.is_empty() {
                "Cherry".to_string()
            } else {
                format!("Cherry — {} — {}", state.title, state.artist)
            };
            tray.set_tooltip(Some(tooltip.chars().take(120).collect::<String>()))
                .map_err(|e| e.to_string())
        })();
        let _ = send.send(result);
    })
    .map_err(|e| e.to_string())?;
    receive.await.map_err(|e| e.to_string())?
}
