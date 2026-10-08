import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Unit tests for the TypeScript layers (core, infra, services). Svelte
// components are not compiled here: the services are written to run in a plain
// DOM (see `platform.ts`), so jsdom is enough and Tauri is simply absent.
export default defineConfig({
  resolve: { alias: { $lib: path.resolve(dirname, 'src/lib') } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
  },
});
