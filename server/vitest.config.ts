import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Berbagi satu berkas SQLite antar worker akan saling mengunci.
    fileParallelism: false,
    env: {
      /*
       * Tes memakai basis data di memori, bukan berkas.
       *
       * Bukan sekadar demi kecepatan: dengan berkas, tes memakai basis data
       * yang sama dengan server dev yang mungkin sedang jalan — dan
       * `resetDatabase()` di tiap kasus akan menghapus data yang sedang
       * dipakai orang di browser sebelah. Kegagalannya tidak menentu dan
       * tampak seperti tes yang rewel, padahal keduanya memang berebut satu
       * berkas.
       */
      DATABASE_FILE: ':memory:',
      // Jangan sampai .env pengembang menyeret tes ke Postgres sungguhan.
      DATABASE_URL: '',
    },
  },
})
