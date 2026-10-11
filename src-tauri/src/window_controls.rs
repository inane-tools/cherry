//! Linux caption buttons are GTK widgets, not copies of theme artwork in HTML.
#[derive(Clone, serde::Serialize)]
pub struct Insets {
    left: i32,
    right: i32,
}

#[cfg(target_os = "linux")]
mod linux {
    use super::Insets;
    use gtk::prelude::*;
    use std::cell::RefCell;
    use tauri::Emitter;

    struct Controls {
        overlay: gtk::Overlay,
        visible: bool,
        zoom: f64,
        handlers: Vec<gtk::glib::SignalHandlerId>,
    }
    thread_local! {
        static CONTROLS: RefCell<Option<Controls>> = const { RefCell::new(None) };
    }

    pub fn update(
        window: &tauri::WebviewWindow,
        visible: bool,
        zoom: f64,
    ) -> Result<Insets, String> {
        let native = window.gtk_window().map_err(|e| e.to_string())?;
        CONTROLS.with(|slot| {
            let mut state = slot.borrow_mut();
            if state.is_none() {
                let container = window.default_vbox().map_err(|e| e.to_string())?;
                let overlay = gtk::Overlay::new();
                let content = gtk::Box::new(gtk::Orientation::Vertical, 0);
                for child in container.children() {
                    container.remove(&child);
                    content.pack_start(&child, true, true, 0);
                }
                overlay.add(&content);
                container.pack_start(&overlay, true, true, 0);
                content.show_all();
                overlay.show();
                let css = gtk::CssProvider::new();
                css.load_from_data(
                    b"
                    .cherry-caption-button {
                        background: transparent;
                        background-image: none;
                        border: none;
                        border-radius: 0;
                        box-shadow: none;
                        min-width: 0;
                        min-height: 0;
                        padding: 0;
                    }
                    .cherry-caption-button:hover {
                        background: alpha(currentColor, 0.10);
                    }
                    .cherry-caption-button.close:hover {
                        background: #c42b1c;
                        color: white;
                    }
                ",
                )
                .map_err(|e| e.to_string())?;
                gtk::StyleContext::add_provider_for_screen(
                    &gtk::prelude::WidgetExt::screen(&native).ok_or("GTK screen unavailable")?,
                    &css,
                    gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
                );
                *state = Some(Controls {
                    overlay,
                    visible,
                    zoom,
                    handlers: Vec::new(),
                });
                if let Some(settings) = gtk::Settings::default() {
                    for property in [
                        "gtk-decoration-layout",
                        "gtk-theme-name",
                        "gtk-icon-theme-name",
                    ] {
                        let win = window.clone();
                        settings.connect_notify_local(Some(property), move |_, _| {
                            let win = win.clone();
                            gtk::glib::idle_add_local_once(move || {
                                let visible = CONTROLS
                                    .with(|s| s.borrow().as_ref().map(|c| (c.visible, c.zoom)));
                                if let Some((visible, zoom)) = visible {
                                    if let Ok(insets) = update(&win, visible, zoom) {
                                        let _ = win.emit("linux-controls-insets", insets);
                                    }
                                }
                            });
                        });
                    }
                }
            }
            let controls = state.as_mut().unwrap();
            controls.visible = visible;
            controls.zoom = zoom;
            for handler in controls.handlers.drain(..) {
                native.disconnect(handler);
            }
            // Keep the main webview as the overlay's ordinary child.
            for child in controls.overlay.children().into_iter().skip(1) {
                controls.overlay.remove(&child);
            }
            let mut insets = Insets { left: 0, right: 0 };
            if !visible {
                return Ok(insets);
            }
            let layout = gtk::Settings::default()
                .map(|s| s.property::<String>("gtk-decoration-layout"))
                .unwrap_or_else(|| ":minimize,maximize,close".into());
            let (left, right) = layout.split_once(':').unwrap_or(("", &layout));
            for (names, align, width) in [
                (left, gtk::Align::Start, &mut insets.left),
                (right, gtk::Align::End, &mut insets.right),
            ] {
                let buttons = gtk::Box::new(gtk::Orientation::Horizontal, 0);
                buttons.set_halign(align);
                buttons.set_valign(gtk::Align::Start);
                buttons.set_size_request(-1, (48.0 * zoom).round() as i32);
                for name in names.split(',') {
                    let (icon, label) = match name {
                        "minimize" => ("window-minimize-symbolic", "Minimize"),
                        "maximize" => ("window-maximize-symbolic", "Maximize / Restore"),
                        "close" => ("window-close-symbolic", "Close"),
                        _ => continue,
                    };
                    let button = gtk::Button::new();
                    button.style_context().add_class("titlebutton");
                    button.style_context().add_class(name);
                    button.style_context().add_class("cherry-caption-button");
                    button.set_valign(gtk::Align::Fill);
                    button.set_size_request((46.0 * zoom).round() as i32, -1);
                    button.set_tooltip_text(Some(label));
                    let image = gtk::Image::from_icon_name(Some(icon), gtk::IconSize::Button);
                    button.set_image(Some(&image));
                    let win = native.clone();
                    let action = name.to_owned();
                    button.connect_clicked(move |_| match action.as_str() {
                        "minimize" => win.iconify(),
                        "maximize" if win.is_maximized() => win.unmaximize(),
                        "maximize" => win.maximize(),
                        "close" => win.close(),
                        _ => {}
                    });
                    if name == "maximize" {
                        let state_image = image.clone();
                        let handler = native.connect_window_state_event(move |_, event| {
                            let icon = if event
                                .new_window_state()
                                .contains(gtk::gdk::WindowState::MAXIMIZED)
                            {
                                "window-restore-symbolic"
                            } else {
                                "window-maximize-symbolic"
                            };
                            state_image.set_from_icon_name(Some(icon), gtk::IconSize::Button);
                            gtk::glib::Propagation::Proceed
                        });
                        controls.handlers.push(handler);
                        if native.is_maximized() {
                            image.set_from_icon_name(
                                Some("window-restore-symbolic"),
                                gtk::IconSize::Button,
                            );
                        }
                    }
                    buttons.pack_start(&button, false, false, 0);
                }
                if buttons.children().is_empty() {
                    continue;
                }
                controls.overlay.add_overlay(&buttons);
                buttons.show_all();
                *width = buttons.preferred_width().1 + (8.0 * zoom).round() as i32;
            }
            Ok(insets)
        })
    }
}

#[tauri::command]
pub async fn set_linux_window_controls(
    window: tauri::WebviewWindow,
    visible: bool,
    zoom: f64,
) -> Result<Insets, String> {
    if window.label() != "main" {
        return Err("Only the main window has custom controls".into());
    }
    let zoom = if zoom.is_finite() {
        zoom.clamp(0.4, 2.5)
    } else {
        1.0
    };
    #[cfg(target_os = "linux")]
    {
        let (send, receive) = tokio::sync::oneshot::channel();
        let native_window = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = send.send(linux::update(&native_window, visible, zoom));
            })
            .map_err(|e| e.to_string())?;
        receive.await.map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (visible, zoom);
        Ok(Insets { left: 0, right: 0 })
    }
}
