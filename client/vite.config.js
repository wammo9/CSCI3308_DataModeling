import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // In local dev mode, proxy API calls to the Express server so cookies and
    // CORS are not an issue. Only applies when running `vite dev`.
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
      '/register': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
    },
  },
});
