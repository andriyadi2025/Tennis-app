import { afterEach, describe, expect, it, vi } from 'vitest'
import { SNAPSHOT_VERSION, isSlotAvailable, persistDb, resetDb, slotId, store } from './db'
import { readJson } from '@/lib/storage'

interface Snapshot {
  version: number
  day: string
  takenSlots: string[]
}

afterEach(() => {
  vi.useRealTimers()
  resetDb()
})

describe('ketersediaan slot bersifat deterministik', () => {
  it('menjawab sama untuk pertanyaan yang sama', () => {
    const iso = new Date(2026, 7, 29, 19).toISOString()
    const first = isSlotAvailable('v-cendana-c3', iso)
    for (let i = 0; i < 20; i += 1) {
      expect(isSlotAvailable('v-cendana-c3', iso)).toBe(first)
    }
  })

  it('membedakan lapangan dan jam', () => {
    const iso = new Date(2026, 7, 29, 19).toISOString()
    const other = new Date(2026, 7, 29, 20).toISOString()
    // Kunci hash berbeda, jadi tidak boleh semuanya kebetulan sama.
    const answers = [
      isSlotAvailable('v-cendana-c1', iso),
      isSlotAvailable('v-cendana-c2', iso),
      isSlotAvailable('v-cendana-c3', iso),
      isSlotAvailable('v-cendana-c3', other),
    ]
    expect(new Set(answers).size).toBeGreaterThan(1)
  })
})

describe('persistDb', () => {
  it('menulis snapshot bersama slot yang sudah dikunci', () => {
    persistDb()
    const snapshot = readJson<Snapshot | null>('mock-db', null)
    expect(snapshot).not.toBeNull()
    // Dibandingkan dengan konstantanya, bukan angka mati: yang perlu dijaga
    // adalah snapshot selalu bercap versi, bukan versinya kebetulan 1.
    expect(snapshot?.version).toBe(SNAPSHOT_VERSION)
    // Booking bawaan mengunci dua jam di Lap. 3.
    expect(snapshot?.takenSlots.length).toBeGreaterThanOrEqual(2)
  })

  it('menyimpan perubahan koleksi, bukan hanya data seed', () => {
    store.tournaments[0]!.slotsTaken = 31
    persistDb()
    const raw = window.localStorage.getItem('dbtc:mock-db') ?? ''
    expect(raw).toContain('"slotsTaken":31')
  })
})

describe('resetDb', () => {
  it('mengembalikan koleksi yang sudah dimutasi ke keadaan awal', () => {
    const before = store.tournaments[0]!.slotsTaken
    store.tournaments[0]!.slotsTaken = 99
    store.reviews.length = 0

    resetDb()

    expect(store.tournaments[0]!.slotsTaken).toBe(before)
    expect(store.reviews.length).toBeGreaterThan(0)
  })

  it('membuang snapshot supaya reload berikutnya benar-benar bersih', () => {
    persistDb()
    expect(window.localStorage.getItem('dbtc:mock-db')).not.toBeNull()

    resetDb()

    expect(window.localStorage.getItem('dbtc:mock-db')).toBeNull()
  })

  it('tidak menyentuh kunci milik aplikasi lain di origin yang sama', () => {
    window.localStorage.setItem('aplikasi-lain', 'jangan-dihapus')
    persistDb()
    resetDb()
    expect(window.localStorage.getItem('aplikasi-lain')).toBe('jangan-dihapus')
  })
})

describe('slotId', () => {
  it('menggabungkan lapangan dan waktu jadi satu kunci', () => {
    expect(slotId('c1', '2026-08-29T12:00:00.000Z')).toBe('c1|2026-08-29T12:00:00.000Z')
  })
})
