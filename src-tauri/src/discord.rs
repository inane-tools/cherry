//! Discord Rich Presence (song title, artist, play state, elapsed).
//!
//! The application id is **runtime configurable** (Settings → Integrations),
//! because a compile-time-only id meant the feature silently did nothing for
//! anyone who didn't build with the env var set. A `CHERRY_DISCORD_APP_ID`
//! build-time value is still used as the default.
//!
//! Commands now report failure instead of silently succeeding: when no id is
//! configured, `discord_set_presence` returns an error the UI can show.
//!
//! ## Lifecycle (who calls what)
//!
//! The *frontend* decides when presence is shown (`player.ts`):
//!  - load / play  → `discord_set_presence` with the current track;
//!  - pause        → the same call, with `is_paused` so the state line reads
//!                   "… · Paused";
//!  - long pause   → after `PAUSE_CLEAR_MS`, `discord_clear_presence`, so a
//!                   forgotten pause stops advertising music entirely. The
//!                   keep-alive and any queued update are suppressed until
//!                   playback resumes.
//!
//! This module only carries out the requested action; it keeps no notion of
//! "paused for too long" itself. `discord_clear_presence` is therefore called
//! repeatedly across a session and must stay idempotent (clearing an activity
//! that is already absent is a no-op). When Discord is closed, the send fails,
//! the client is dropped, and the next update reconnects.

use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

/// Discord application id, baked in so the feature works out of the box.
/// A `CHERRY_DISCORD_APP_ID` build-time value still takes precedence.
const ENV_APP_ID: Option<&str> = option_env!("CHERRY_DISCORD_APP_ID");
const DEFAULT_APP_ID: &str = match ENV_APP_ID {
    Some(value) => value,
    None => "1550170326481109063",
};

/// Rich Presence asset key for the app's own icon.
///
/// Discord renders small images from the **application's uploaded asset
/// library**, not from a URL or the local exe icon: the name here must match an
/// asset uploaded to the Discord application (App → Rich Presence → Art Assets).
/// It is shown as a small badge on the album-art corner so the presence is
/// identifiably Cherry. A `CHERRY_DISCORD_ICON` build-time value overrides it.
const ENV_ICON: Option<&str> = option_env!("CHERRY_DISCORD_ICON");
const DEFAULT_ICON: &str = match ENV_ICON {
    Some(value) => value,
    None => "cherry",
};

#[derive(Default)]
pub struct DiscordState(pub Mutex<DiscordInner>);

#[derive(Default)]
pub struct DiscordInner {
    app_id: String,
    client: Option<DiscordIpcClient>,
    connected: bool,
}

impl DiscordInner {
    fn reset(&mut self) {
        self.client = None;
        self.connected = false;
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresencePayload {
    pub title: String,
    pub artist: String,
    #[serde(default)]
    pub album: String,
    /// Album art URL. Used as the large image so presence resembles Spotify's.
    #[serde(default)]
    pub artwork: String,
    #[serde(default)]
    pub is_playing: bool,
    /// True for paused / ended, but not for the brief loading state.
    #[serde(default)]
    pub is_paused: bool,
    #[serde(default)]
    pub position_secs: i64,
    #[serde(default)]
    pub duration_secs: i64,
    /// Which line to show next to the member's name: `details` (song title,
    /// default), `state` (artists) or `name` (the Discord application name).
    #[serde(default)]
    pub status_display: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordStatus {
    pub app_id: String,
    pub configured: bool,
    pub connected: bool,
}

fn ensure_connected(inner: &mut DiscordInner) -> Result<(), String> {
    if inner.app_id.is_empty() {
        return Err("discord application id is not configured".into());
    }
    if inner.client.is_none() {
        inner.client = Some(DiscordIpcClient::new(&inner.app_id).map_err(|e| e.to_string())?);
    }
    if !inner.connected {
        if let Some(client) = inner.client.as_mut() {
            client.connect().map_err(|e| e.to_string())?;
        }
        inner.connected = true;
    }
    Ok(())
}

/// Configure the application id. Passing an empty string disables presence.
#[tauri::command]
pub fn discord_set_app_id(state: State<DiscordState>, app_id: String) -> Result<DiscordStatus, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let app_id = app_id.trim().to_string();
    if guard.app_id != app_id {
        // Different application id → the existing IPC client is invalid.
        guard.reset();
        guard.app_id = app_id;
    }
    if guard.app_id.is_empty() {
        guard.app_id = DEFAULT_APP_ID.trim().to_string();
    }
    Ok(status_of(&guard))
}

#[tauri::command]
pub fn discord_status(state: State<DiscordState>) -> Result<DiscordStatus, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.app_id.is_empty() {
        guard.app_id = DEFAULT_APP_ID.trim().to_string();
    }
    Ok(status_of(&guard))
}

fn status_of(inner: &DiscordInner) -> DiscordStatus {
    DiscordStatus {
        app_id: inner.app_id.clone(),
        configured: !inner.app_id.is_empty(),
        connected: inner.connected,
    }
}

#[tauri::command]
pub fn discord_set_presence(
    state: State<DiscordState>,
    payload: PresencePayload,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.app_id.is_empty() {
        guard.app_id = DEFAULT_APP_ID.trim().to_string();
    }
    // Surface the real reason instead of a silent no-op.
    ensure_connected(&mut guard)?;

    let Some(client) = guard.client.as_mut() else {
        return Err("discord client unavailable".into());
    };

    // The activity JSON is built by hand rather than through the crate's
    // `Activity` builder so we can send `status_display_type`, which the crate
    // (0.2.x) predates.
    let activity = build_activity(&payload);
    let envelope = serde_json::json!({
        "cmd": "SET_ACTIVITY",
        "args": { "pid": std::process::id(), "activity": activity },
        "nonce": nonce(),
    });

    // Discord was probably closed meanwhile → drop the client so the next
    // update reconnects instead of failing forever.
    if let Err(e) = client.send(envelope, 1) {
        guard.reset();
        return Err(e.to_string());
    }
    Ok(())
}

/// Discord's `status_display_type`: which line Discord shows next to the user's
/// name in the member list (and on the profile card as "Listening to …").
///
/// Values per Discord's docs (discord-api-docs PR #7674) and the official SDKs:
/// `0 = name`, `1 = state`, `2 = details`. Getting these the wrong way round
/// swaps the song and artist lines, so they are asserted in the tests below.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StatusDisplayType {
    Name = 0,
    State = 1,
    Details = 2,
}

fn parse_status_display(value: &str) -> StatusDisplayType {
    match value {
        "name" => StatusDisplayType::Name,
        "state" => StatusDisplayType::State,
        // Song title (details) is the default, matching Spotify.
        _ => StatusDisplayType::Details,
    }
}

fn nonce() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("cherry-{}-{}", std::process::id(), millis)
}

/// Build the rich-presence activity object.
///
///   type                = 2 (Listening) → music-note icon, "Listening to …"
///   status_display_type = which line shows next to the member's name
///   details             = song title
///   state               = artists
///   assets.large_image  = album art URL
fn build_activity(payload: &PresencePayload) -> serde_json::Value {
    let details = truncate(if payload.title.trim().is_empty() { "Unknown" } else { &payload.title }, 128);

    // Pausing is reflected explicitly: RPC timers cannot be "frozen", so
    // without a marker nothing would visibly change when the user pauses. The
    // artist is truncated to leave room for the marker so it can't be cut off.
    let mut artists = payload.artist.trim().to_string();
    if payload.is_paused {
        if artists.is_empty() {
            artists = "Paused".to_string();
        } else {
            const MARKER: &str = " · Paused";
            let budget = 128usize.saturating_sub(MARKER.len());
            artists = format!("{}{}", truncate(&artists, budget), MARKER);
        }
    }

    let mut activity = serde_json::json!({
        "type": 2,
        "status_display_type": parse_status_display(&payload.status_display) as u8,
        "details": details,
    });
    if !artists.trim().is_empty() {
        activity["state"] = serde_json::Value::String(artists);
    }

    // Only advertise images we actually have; referencing an app asset the
    // user never uploaded would render as a broken image. The album name is
    // only used as hover text when we know it — no placeholder app label.
    if payload.artwork.starts_with("https://") {
        let mut assets = serde_json::json!({ "large_image": payload.artwork });
        if !payload.album.trim().is_empty() {
            assets["large_text"] = serde_json::Value::String(truncate(&payload.album, 128));
        }
        // The app icon as a small badge over the album art. Discord draws a
        // broken/missing asset as nothing at all, so this is safe even before
        // the user uploads the asset — it simply does not appear.
        let icon = DEFAULT_ICON.trim();
        if !icon.is_empty() {
            assets["small_image"] = serde_json::Value::String(icon.to_string());
        }
        activity["assets"] = assets;
    }

    // A start/end pair makes Discord render the elapsed bar. Clamp the position
    // so a stale/oversized value can never put the end before the current time.
    let now = || {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    };
    if payload.is_playing && payload.duration_secs > 0 {
        let now = now();
        let position = payload.position_secs.clamp(0, payload.duration_secs);
        let start = now.saturating_sub(position);
        activity["timestamps"] = serde_json::json!({
            "start": start,
            "end": start + payload.duration_secs,
        });
    } else if payload.is_paused {
        // Discord renders "time since the last activity update" when no
        // timestamps are sent — which reads as a *running* paused-time counter.
        // An `end` that has already passed makes it show a frozen "0:00 left"
        // instead, so a pause never looks like a countdown.
        let now = now();
        activity["timestamps"] = serde_json::json!({ "start": now, "end": now });
    }

    activity
}

#[tauri::command]
pub fn discord_clear_presence(state: State<DiscordState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(client) = guard.client.as_mut() {
        if client.clear_activity().is_err() {
            guard.reset();
        }
    }
    Ok(())
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    // Reserve the *byte* length of the ellipsis, not one character, otherwise
    // the result can overflow `max` (and Discord's limits) by two bytes.
    const ELLIPSIS: &str = "…";
    let budget = max.saturating_sub(ELLIPSIS.len());
    let mut out = String::new();
    for (i, c) in s.char_indices() {
        if i + c.len_utf8() > budget {
            break;
        }
        out.push(c);
    }
    out.push_str(ELLIPSIS);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Presence must work with no user configuration, so the application id is
    /// compiled in. A `CHERRY_DISCORD_APP_ID` at build time may override it.
    #[test]
    fn discord_app_id_is_baked_in() {
        if ENV_APP_ID.is_none() {
            assert_eq!(DEFAULT_APP_ID, "1550170326481109063");
        }
        assert!(
            !DEFAULT_APP_ID.trim().is_empty(),
            "rich presence needs an application id to connect"
        );
    }

    fn payload(status_display: &str) -> PresencePayload {
        PresencePayload {
            title: "Song Title".into(),
            artist: "Some Artist".into(),
            album: "Some Album".into(),
            artwork: "https://example.com/art.jpg".into(),
            is_playing: true,
            is_paused: false,
            position_secs: 12,
            duration_secs: 200,
            status_display: status_display.into(),
        }
    }

    /// The difference between a plain "Playing" activity and Discord's
    /// music-note "Listening to" treatment is purely the `type` field, and the
    /// line shown next to the member's name is controlled by
    /// `status_display_type` — neither is observable without a live Discord
    /// client, so they are asserted here.
    #[test]
    fn activity_is_listening_with_song_title_as_status() {
        let activity = build_activity(&payload("details"));
        assert_eq!(activity.get("type").and_then(|v| v.as_u64()), Some(2));
        assert_eq!(
            activity.get("status_display_type").and_then(|v| v.as_u64()),
            Some(2),
            "details (song title) is status_display_type 2"
        );
        assert_eq!(activity.get("details").and_then(|v| v.as_str()), Some("Song Title"));
        assert_eq!(activity.get("state").and_then(|v| v.as_str()), Some("Some Artist"));
        assert_eq!(
            activity.pointer("/assets/large_image").and_then(|v| v.as_str()),
            Some("https://example.com/art.jpg"),
            "album art must be the large image"
        );
        assert_eq!(
            activity.pointer("/assets/small_image").and_then(|v| v.as_str()),
            Some(DEFAULT_ICON),
            "the app icon badge is the small image"
        );
        assert!(activity.get("timestamps").is_some());
    }

    /// A stale or oversized position must never place the end before "now";
    /// otherwise Discord renders a nonsensical/negative timer.
    #[test]
    fn elapsed_timer_is_clamped_to_the_duration() {
        let now = || {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64
        };
        let mut p = payload("details");
        p.position_secs = 9_999;
        p.duration_secs = 200;
        let before = now();
        let activity = build_activity(&p);
        let after = now();
        let start = activity.pointer("/timestamps/start").and_then(|v| v.as_i64()).unwrap();
        let end = activity.pointer("/timestamps/end").and_then(|v| v.as_i64()).unwrap();
        assert_eq!(end - start, 200, "end is exactly one duration after start");
        assert!(
            (before - 200..=after - 200).contains(&start),
            "position is clamped to the duration, not carried past it"
        );
        assert!(end >= after, "the track must not appear already finished");
    }

    /// A very long artist name must still show that playback is paused.
    #[test]
    fn paused_marker_survives_a_long_artist() {
        let mut p = payload("details");
        p.artist = "A".repeat(300);
        p.is_playing = false;
        p.is_paused = true;
        let state = build_activity(&p).get("state").and_then(|v| v.as_str()).unwrap().to_string();
        assert!(state.len() <= 128, "the state line must stay within Discord's limit");
        assert!(state.ends_with(" · Paused"), "the paused marker must not be truncated away");
    }

    /// The truncation helper must respect its byte budget, including for
    /// multi-byte payloads (the ellipsis is three bytes).
    #[test]
    fn truncate_never_exceeds_the_limit() {
        assert!(truncate(&"é".repeat(200), 128).len() <= 128);
        assert!(truncate(&"A".repeat(200), 128).len() <= 128);
        assert!(truncate("short", 128) == "short");
        assert!(truncate(&"A".repeat(200), 128).ends_with('…'));
    }

    /// Regression guard for the swapped song/artist lines: Discord's enum is
    /// `0 = name`, `1 = state`, `2 = details`.
    #[test]
    fn status_display_values_match_discord_enum() {
        assert_eq!(
            build_activity(&payload("state")).get("status_display_type").and_then(|v| v.as_u64()),
            Some(1),
            "artist (state) is 1"
        );
        assert_eq!(
            build_activity(&payload("name")).get("status_display_type").and_then(|v| v.as_u64()),
            Some(0)
        );
        // Unknown values fall back to the song title.
        assert_eq!(
            build_activity(&payload("nonsense")).get("status_display_type").and_then(|v| v.as_u64()),
            Some(2)
        );
    }

    /// RPC timers cannot be paused, so a visible marker is required — and the
    /// timer must be frozen rather than left absent (Discord turns an absent
    /// timer into "time since last update").
    #[test]
    fn pausing_is_visible_and_freezes_the_timer() {
        let mut p = payload("details");
        p.is_playing = false;
        p.is_paused = true;
        let activity = build_activity(&p);
        assert_eq!(activity.get("state").and_then(|v| v.as_str()), Some("Some Artist · Paused"));
        let start = activity.pointer("/timestamps/start").and_then(|v| v.as_i64()).unwrap();
        let end = activity.pointer("/timestamps/end").and_then(|v| v.as_i64()).unwrap();
        assert_eq!(start, end, "a paused track reports an elapsed (frozen) timer");

        // Untagged artist still yields something meaningful.
        p.artist = String::new();
        assert_eq!(build_activity(&p).get("state").and_then(|v| v.as_str()), Some("Paused"));
    }

    /// A missing/blank artwork URL must not reference an app asset the user
    /// never uploaded, and no placeholder app label is added.
    #[test]
    fn no_assets_when_artwork_is_missing() {
        let mut p = payload("details");
        p.artwork = String::new();
        p.album = String::new();
        p.is_playing = false;
        let activity = build_activity(&p);
        assert!(activity.get("assets").is_none());
        assert!(activity.get("timestamps").is_none(), "paused sends no timestamps");
    }

    /// The album is used as hover text only when known.
    #[test]
    fn album_is_hover_text_only_when_present() {
        let mut p = payload("details");
        p.album = String::new();
        let activity = build_activity(&p);
        assert!(activity.pointer("/assets/large_text").is_none());

        p.album = "Some Album".into();
        let activity = build_activity(&p);
        assert_eq!(
            activity.pointer("/assets/large_text").and_then(|v| v.as_str()),
            Some("Some Album")
        );
    }
}
