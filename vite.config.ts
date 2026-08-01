import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte()],
  resolve: {
    conditions: ['browser'],
  },
  // prevent vite from obscuring rust errors
  clearScreen: false,
  server: {
    // Tauri expects a fixed port
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    globals: true,
    // 'vmForks' hangs indefinitely on this suite (no output after `RUN v4.x`);
    // 'forks' runs it in a few seconds. See docs/LEARNINGS.md.
    pool: 'forks',
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});