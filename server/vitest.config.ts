import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Berbagi satu berkas SQLite antar worker akan saling mengunci.
    fileParallelism: false,
  },
})
