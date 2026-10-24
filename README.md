# Cherry

A YouTube Music desktop client for Windows, macOS and Linux, with a completely
custom interface. Your music, my way.

I didn’t like how YouTube Music looked or felt to use, and I couldn’t find an
alternative I liked. So I made my own.

Made by [inane.tools](https://inane.tools). More about Cherry at
[inane.tools/cherry](https://inane.tools/cherry).

![Cherry](https://inane.tools/screenshot-compact.webp)

> ### ⚠️ Disclaimer
> Cherry is an unofficial client and is **not affiliated with, endorsed by, or
> associated with YouTube, Google or YouTube Music**. All trademarks and content
> belong to their respective owners. To use Cherry, you need your **own YouTube account**. You are responsible for how you use it
> and for any consequences, including any effect on your account. The software is
> provided **as is**, without warranty of any kind.

## What does it do?

- Organise playlists in folders, pin your favourites, and create or edit playlists.
- Listen with artwork, lyrics or music videos up to 1080p. Start a mix from any song.
- Search the catalogue or paste a YouTube link. Drag tracks around your queue.
- Use light or dark mode, artwork colours, custom accents and tinted backgrounds.
- Sign in inside the app and switch between accounts. Saved sign-ins use your
  operating system’s secure storage.
- Use media keys, keyboard shortcuts and a sleep timer. Share what’s playing on
  Discord and scrobble to Last.fm.

See [the website](https://inane.tools/cherry) for more, or the
[changelog](CHANGELOG.md) for what’s changed.

## Download

Get the latest version from [GitHub Releases](https://github.com/inane-tools/cherry/releases/latest).

- **Windows:** the x64 setup installer.
- **macOS:** the arm64 DMG for Apple Silicon, or x64 DMG for Intel. Open it and
  drag Cherry into Applications. Builds are ad-hoc signed and not notarized;
  see [the macOS guide](docs/MACOS.md) if macOS blocks opening it.
- **Linux:** an x86_64 AppImage or Flatpak bundle. Cherry isn’t on Flathub.
  See [the packaging guide](docs/RELEASING.md) for details.

Windows and AppImage builds check GitHub for updates. macOS and Flatpak updates
are installed manually.

**Coming from Cherry 1.x?** Keep it installed and close it before importing.
Install 2.0, then choose **Migrate from 1.x** on the welcome screen after accepting
the disclaimer. Check your imported data before removing the old app.
[Migration notes](docs/MIGRATION.md).

## Develop

Cherry uses Electron + Chromium, Svelte 5, TypeScript and Tailwind v4. Use Node 24
and npm.

```bash
npm ci
npm run dev
```

```bash
npm run typecheck
npm test
npm run test:smoke
```

Restart Electron after changing the main process or preload. For the rest, see
[architecture](docs/ELECTRON.md), [testing](docs/TESTING.md) and
[packaging and releases](docs/RELEASING.md).

## Who built Cherry?

Cherry is developed with LLMs, guided by [inane.tools](https://inane.tools).
DeepSeek v4.1 Flash generated much of the original code through 1.4. Codex with
GPT-6.1 Sol has contributed since 1.4.2.

Thanks to [jannuary](https://github.com/jannuary/cherry), whose fork contributed
Claude-authored fixes, tests, keyboard shortcuts and the sleep timer. Those
commits are preserved in the history. See [CONTRIBUTORS.md](CONTRIBUTORS.md).

The original Tauri app is preserved in
[cherry-tauri](https://github.com/inane-tools/cherry-tauri).

## License

[MIT](LICENSE) © 2026 [inane.tools](https://inane.tools)
