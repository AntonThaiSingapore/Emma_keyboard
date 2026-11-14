import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, /api and /health proxy to the FastAPI server on :8000 so the browser
// only ever talks to one origin. In production the frontend calls the same
// relative paths, which the platform routes to the backend service.
// VITE_DEV_API lets a second checkout run beside another app already on :8000
// (e.g. VITE_DEV_API=http://127.0.0.1:8010 npm run dev). Deploys never read it.
const target = process.env.VITE_DEV_API || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/health': { target, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
})
