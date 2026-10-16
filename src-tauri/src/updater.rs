fn environment(os: &str, debug: bool, flatpak: bool, appimage: bool) -> &'static str {
    if debug {
        return "development";
    }
    if flatpak {
        return "flatpak";
    }
    match os {
        "windows" => "windows",
        "linux" if appimage => "appimage",
        _ => "manual",
    }
}

#[tauri::command]
pub fn updater_environment() -> &'static str {
    environment(
        std::env::consts::OS,
        cfg!(debug_assertions),
        std::env::var_os("FLATPAK_ID").is_some() || std::path::Path::new("/.flatpak-info").exists(),
        std::env::var_os("APPIMAGE").is_some(),
    )
}

#[cfg(test)]
mod tests {
    use super::environment;
    #[test]
    fn only_supported_installed_packages_self_update() {
        assert_eq!(environment("windows", false, false, false), "windows");
        assert_eq!(environment("linux", false, false, true), "appimage");
        assert_eq!(environment("linux", false, true, true), "flatpak");
        assert_eq!(environment("windows", true, false, false), "development");
        assert_eq!(environment("linux", false, false, false), "manual");
        assert_eq!(environment("macos", false, false, false), "manual");
    }
}
