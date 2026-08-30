import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite configuration for the SmartPark India web app (Phase 1A).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
