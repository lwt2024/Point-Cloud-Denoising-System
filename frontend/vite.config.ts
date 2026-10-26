import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          "orbit-controls": ["three/addons/controls/OrbitControls.js"],
        },
      },
    },
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
