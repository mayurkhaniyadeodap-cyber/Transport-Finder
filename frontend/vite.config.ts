import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8000" },
  },
  test: {
    environment: "jsdom",
    // Some UI tests sign in several times; 5s (the default) is too tight when every file runs at once.
    testTimeout: 15000,
  },
});
