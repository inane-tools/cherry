# Cherry GTK overlay compatibility patch

Source: tauri-runtime-wry 2.11.4 from crates.io, with original MIT/Apache licenses.

Only `src/undecorated_resizing.rs` differs: Linux mouse and touch resize handlers
resolve the webview's GTK toplevel and safely downcast it to a window. Upstream
assumes the grandparent is a GtkWindow and unwraps the downcast; Cherry's native
caption-button overlay makes it a GtkOverlay, causing an abort on any click.

Windows/macOS behavior is unchanged. Keep this patch when updating the runtime,
or remove it once upstream safely resolves the toplevel. Native regression checks:
click Settings, drag the topbar, double-click maximize/restore, resize every edge
and corner, and exercise touch resizing with controls visible and hidden.
