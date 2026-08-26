import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { cleanup } from '@testing-library/react'
import { server } from '@/mocks/server'
import { resetDb } from '@/mocks/db'

// MSW yang sama dengan yang dipakai app — tes memukul kontrak yang nyata.
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })

  /*
   * Lingkungan jsdom mengganti AbortController/AbortSignal global dengan
   * miliknya sendiri, sedangkan `fetch` bawaan Node menolak signal yang bukan
   * instance miliknya ("Expected signal to be an instance of AbortSignal").
   * TanStack Query selalu mengoper signal, jadi tanpa ini setiap permintaan
   * gagal di tes meskipun kodenya benar di peramban.
   *
   * Pembungkus ini dipasang SETELAH server.listen() supaya berjalan sebelum
   * interceptor MSW, dan hanya melepas `signal` — pembatalan request memang
   * bukan yang sedang diuji di sini, dan di peramban tetap aktif.
   */
  const upstream = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (init && 'signal' in init) {
      const { signal: _signal, ...withoutSignal } = init
      return upstream(input, withoutSignal)
    }
    return upstream(input, init)
  }) as typeof fetch
})

afterEach(() => {
  cleanup()
  server.resetHandlers()
  resetDb()
  window.localStorage.clear()
})

afterAll(() => server.close())
