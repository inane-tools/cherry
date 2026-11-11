# Decisions

One line each, newest first: `YYYY-MM-DD — decision — why.`
Longer reasoning belongs in ARCHITECTURE.md or the PR.

- 2026-11-11 — Project state moves from CLAUDE.md to docs/STATUS.md — keeps the always-loaded context small for multi-session work.
- 2026-11-10 — Release commits never contain `[skip ci]` — it also skips the tag-push workflow, so nothing builds.
- 2026-11-10 — Truncated playlist/album reads are not cached — when a later page failed, the partial list was cached as the whole playlist, so reopening it showed missing songs and a lowered song count (CHANGELOG 2.2.1).
- 2026-10-19 — Electron replaces Tauri in 2.0.0 Furano, with no Rust or Tauri packages; Tauri source moves to cherry-tauri and 1.x data is imported on request — parity across operating systems, smoothness and development time: Tauri uses each OS's own web engine, and on Linux (WebKitGTK) it took a lot of extra workarounds and was still a much worse experience. One engine everywhere means no OS feels second-class.
