import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API_TARGET = "http://127.0.0.1:4321";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": API_TARGET,
      "/mcp": API_TARGET,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
