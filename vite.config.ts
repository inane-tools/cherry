import { defineConfig } from 'vite';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.TAURI_DEV_HOST;

/** Single source of truth for the app version shown in Settings. */
function appVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(dirname, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function buildStamp(): string {
  let rev = 'nogit';
  try {
    rev = execSync('git rev-parse --short HEAD', { cwd: dirname }).toString().trim();
  } catch {
    /* not a git checkout */
  }
  return `${rev} · ${new Date().toISOString().replace('T', ' ').slice(0, 19)}Z`;
}

// https://vite.dev/config/ + https://v2.tauri.app/reference/config/
export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  resolve: { alias: { $lib: path.resolve(dirname, 'src/lib') } },
  define: {
    __CHERRY_BUILD__: JSON.stringify(buildStamp()),
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || '127.0.0.1',
    // WebView2 caches dev modules across app restarts, which made edits look
    // like they were not applied. Never cache them while developing.
    headers: { 'Cache-Control': 'no-store' },
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'oxc' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
