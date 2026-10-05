import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /api -> the FastAPI backend so the browser never needs CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});