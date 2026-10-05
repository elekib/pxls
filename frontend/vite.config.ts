import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// In development, forward /api to the backend. In production nginx does the same.
const apiTarget = process.env.PXLS_DEV_API || 'http://127.0.0.1:3400'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      // Keep the browser's Host header: the backend's CSRF check compares it with Origin.
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
})
