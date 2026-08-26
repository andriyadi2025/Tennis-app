import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Migrasi prefiks berjalan sekali saat modul dimuat, jadi tiap kasus perlu
 * modul yang benar-benar baru — bukan yang sudah terlanjur jalan di kasus lain.
 */
async function loadStorage() {
  vi.resetModules()
  return import('./storage')
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('namespace', () => {
  it('menulis dan membaca di bawah prefiks dbtc:', async () => {
    const storage = await loadStorage()
    storage.writeJson('halo', { a: 1 })

    expect(window.localStorage.getItem('dbtc:halo')).toBe('{"a":1}')
    expect(storage.readJson('halo', null)).toEqual({ a: 1 })
  })

  it('mengembalikan fallback untuk kunci yang tidak ada', async () => {
    const storage = await loadStorage()
    expect(storage.readJson('belum-ada', 'bawaan')).toBe('bawaan')
  })

  it('mengembalikan fallback kalau isinya bukan JSON yang sah', async () => {
    window.localStorage.setItem('dbtc:rusak', '{bukan json')
    const storage = await loadStorage()
    expect(storage.readJson('rusak', 'bawaan')).toBe('bawaan')
  })
})

describe('migrasi dari prefiks lama', () => {
  it('memindahkan kunci lapangin: ke dbtc:', async () => {
    window.localStorage.setItem('lapangin:auth', '{"user":"raka"}')
    window.localStorage.setItem('lapangin:booking-draft', '{"stage":"draft"}')

    await loadStorage()

    expect(window.localStorage.getItem('dbtc:auth')).toBe('{"user":"raka"}')
    expect(window.localStorage.getItem('dbtc:booking-draft')).toBe('{"stage":"draft"}')
    // Kunci lama dibersihkan supaya tidak tertinggal jadi sampah.
    expect(window.localStorage.getItem('lapangin:auth')).toBeNull()
    expect(window.localStorage.getItem('lapangin:booking-draft')).toBeNull()
  })

  it('tidak menimpa data baru yang sudah ada', async () => {
    window.localStorage.setItem('lapangin:auth', '"lama"')
    window.localStorage.setItem('dbtc:auth', '"baru"')

    await loadStorage()

    expect(window.localStorage.getItem('dbtc:auth')).toBe('"baru"')
    expect(window.localStorage.getItem('lapangin:auth')).toBeNull()
  })

  it('tidak menyentuh kunci milik aplikasi lain', async () => {
    window.localStorage.setItem('aplikasi-lain', 'aman')
    window.localStorage.setItem('lapangin:auth', '"pindah"')

    await loadStorage()

    expect(window.localStorage.getItem('aplikasi-lain')).toBe('aman')
  })
})

describe('clearAll', () => {
  it('hanya menghapus kunci berprefiks dbtc:', async () => {
    const storage = await loadStorage()
    storage.writeJson('satu', 1)
    storage.writeJson('dua', 2)
    window.localStorage.setItem('aplikasi-lain', 'aman')

    storage.clearAll()

    expect(window.localStorage.getItem('dbtc:satu')).toBeNull()
    expect(window.localStorage.getItem('dbtc:dua')).toBeNull()
    expect(window.localStorage.getItem('aplikasi-lain')).toBe('aman')
  })
})
