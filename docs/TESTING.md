# Testing

Run `npm run typecheck`, `npm test`, `npm run test:smoke` and `npm run pack`.

The smoke test opens no visible window and uses a separate temporary profile.
It verifies app startup, renderer isolation, settings, encrypted credentials and
network policy. It does not sign in or validate live music playback.

See [ELECTRON.md](ELECTRON.md) for manual playback and platform checks.

The current electron-builder dependency tree reports moderate development-only
logger advisories through sprintf-js, for which no patched version is published.
Runtime production dependencies have no reported npm advisories. Do not apply
`npm audit fix --force` blindly; review packaging-tool changes separately.
