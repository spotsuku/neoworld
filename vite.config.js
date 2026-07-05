import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // three.js を含む3Dビューは遅延ロードの別チャンク(~700kB)になるため上限を調整
    chunkSizeWarningLimit: 900,
  },
});
