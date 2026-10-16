import { defineConfig } from 'vite';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const host = '127.0.0.1';

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

// Frontend served by Vite in development and the app protocol when packaged.
export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  resolve: { alias: { $lib: path.resolve(dirname, 'src/lib') } },
  define: {
    __CHERRY_BUILD__: JSON.stringify(buildStamp()),
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  clearScreen: false,
  server: {
    port: 1423,
    strictPort: true,
    host: host || '127.0.0.1',
    // Electron caches dev modules across app restarts, which made edits look
    // like they were not applied. Never cache them while developing.
    headers: { 'Cache-Control': 'no-store' },
    hmr: { host, port: 1423 },
    watch: { ignored: ['**/electron/**'] },
  },
  build: {
    // Match Tailwind 4's browser floor; older browsers cannot render the UI.
    target: 'chrome146',
    minify: 'oxc',
    sourcemap: false,
  },
});
