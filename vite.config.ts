import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Port diambil dari lingkungan kalau disediakan, supaya beberapa dev server
  // bisa hidup berdampingan tanpa saling merebut port.
  server: { port: Number(process.env.PORT) || 5173 },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
    // Layar yang menunggu beberapa permintaan berantai butuh ruang lebih dari 5s.
    testTimeout: 15_000,
  },
})
