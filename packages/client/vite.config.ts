import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "packages/client",
  plugins: [react()],
  server: {
    port: 5173,
    // Der Client spricht nie direkt mit der Datenbank, immer nur mit der API
    proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: true } },
  },
  build: { outDir: "../../dist/client", emptyOutDir: true },
});
