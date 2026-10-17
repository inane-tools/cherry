import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  plugins: [svelte()],
  resolve: { conditions: ['browser'], alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) } },
  test: { environment: 'jsdom', include: ['tests/ui/**/*.test.ts'], restoreMocks: true },
});
