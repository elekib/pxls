import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development, forward /api to the backend. In production nginx does the same.
const apiTarget = process.env.PXLS_DEV_API || 'http://127.0.0.1:3400'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
})
