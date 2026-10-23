import { defineConfig } from "vite";

/**
 * The editor is a plain static bundle so it can be embedded in any WebView
 * (Tauri, Electron, Android, ...). No dev server assumptions at runtime.
 */
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
