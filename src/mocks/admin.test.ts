import { afterEach, describe, expect, it } from 'vitest'
import type { ClubSettings, CourtDraft } from '@/types'
import { validateCourt, validateSettings } from './handlers'
import { applySettingsToVenue, findVenue, isPrimeHour, priceFor, resetDb, store } from './db'

afterEach(() => resetDb())

function settings(patch: Partial<ClubSettings> = {}): ClubSettings {
  return { ...store.settings, ...patch }
}

function court(patch: Partial<CourtDraft> = {}): CourtDraft {
  return {
    name: 'Lap. 9',
    sport: 'tennis',
    indoor: false,
    surface: 'Hard court',
    pricePerHourIdr: null,
    ...patch,
  }
}

describe('validateSettings', () => {
  it('menerima pengaturan bawaan', () => {
    expect(validateSettings(settings())).toBeNull()
  })

  it('menolak nama atau alamat kosong', () => {
    expect(validateSettings(settings({ name: '  ' }))).toMatch(/Nama klub/)
    expect(validateSettings(settings({ address: '' }))).toMatch(/Alamat/)
  })

  it('menolak jam tutup yang tidak setelah jam buka', () => {
    expect(validateSettings(settings({ openHours: { open: 20, close: 20 } }))).toMatch(
      /lebih malam/,
    )
    expect(validateSettings(settings({ openHours: { open: 20, close: 8 } }))).toMatch(/lebih malam/)
  })

  it('menolak jam di luar rentang yang masuk akal', () => {
    expect(validateSettings(settings({ openHours: { open: -1, close: 22 } }))).toMatch(/0 dan 23/)
    expect(validateSettings(settings({ openHours: { open: 6, close: 25 } }))).toMatch(/1 dan 24/)
  })

  it('menolak tarif dasar yang terlalu kecil', () => {
    expect(validateSettings(settings({ basePricePerHourIdr: 500 }))).toMatch(/minimal Rp1.000/)
  })

  it('menolak pengali prime time di luar 1–3', () => {
    expect(
      validateSettings(settings({ primeTime: { from: 18, to: 21, multiplier: 0.5 } })),
    ).toMatch(/antara 1 dan 3/)
    expect(validateSettings(settings({ primeTime: { from: 18, to: 21, multiplier: 4 } }))).toMatch(
      /antara 1 dan 3/,
    )
  })

  it('menerima prime time yang melewati tengah malam', () => {
    expect(
      validateSettings(settings({ primeTime: { from: 20, to: 1, multiplier: 1.5 } })),
    ).toBeNull()
  })

  it('menolak potongan anggota di atas 90%', () => {
    expect(
      validateSettings(settings({ membership: { duesMonthlyIdr: 0, memberDiscount: 0.95 } })),
    ).toMatch(/0% dan 90%/)
  })
})

describe('validateCourt', () => {
  it('menerima lapangan yang wajar', () => {
    expect(validateCourt(court(), [])).toBeNull()
  })

  it('menolak nama kosong', () => {
    expect(validateCourt(court({ name: '   ' }), [])).toMatch(/Nama lapangan/)
  })

  it('menolak nama yang bentrok, tanpa peduli besar-kecil huruf', () => {
    const existing = store.venues.find((v) => v.id === 'v-dbtc')!.courts
    const clash = validateCourt(court({ name: existing[0]!.name.toLowerCase() }), existing)
    expect(clash).toMatch(/Sudah ada lapangan/)
  })

  it('menolak permukaan kosong', () => {
    expect(validateCourt(court({ surface: '' }), [])).toMatch(/permukaan/)
  })

  it('menerima tarif kosong sebagai ikut tarif dasar', () => {
    expect(validateCourt(court({ pricePerHourIdr: null }), [])).toBeNull()
  })

  it('menolak tarif khusus yang terlalu kecil', () => {
    expect(validateCourt(court({ pricePerHourIdr: 100 }), [])).toMatch(/minimal Rp1.000/)
  })
})

describe('isPrimeHour', () => {
  it('menangani jendela biasa', () => {
    const prime = { from: 18, to: 21, multiplier: 1.2 }
    expect(isPrimeHour(17, prime)).toBe(false)
    expect(isPrimeHour(18, prime)).toBe(true)
    expect(isPrimeHour(21, prime)).toBe(true)
    expect(isPrimeHour(22, prime)).toBe(false)
  })

  it('menangani jendela yang melewati tengah malam', () => {
    const prime = { from: 20, to: 1, multiplier: 1.5 }
    expect(isPrimeHour(19, prime)).toBe(false)
    expect(isPrimeHour(20, prime)).toBe(true)
    expect(isPrimeHour(0, prime)).toBe(true)
    expect(isPrimeHour(1, prime)).toBe(true)
    expect(isPrimeHour(2, prime)).toBe(false)
  })
})

describe('priceFor mengikuti pengaturan klub', () => {
  it('memakai jendela prime time dari pengaturan, bukan angka tetap', () => {
    const venue = findVenue('v-dbtc')!
    const court = venue.courts[0]!

    // Bawaan: 18–21 naik 20%.
    expect(priceFor(venue, court, 19)).toBe(72_000)
    expect(priceFor(venue, court, 10)).toBe(60_000)

    store.settings.primeTime = { from: 9, to: 11, multiplier: 1.5 }
    expect(priceFor(venue, court, 10)).toBe(90_000)
    expect(priceFor(venue, court, 19)).toBe(60_000)
  })

  it('venue lain tetap memakai aturan bawaan', () => {
    store.settings.primeTime = { from: 9, to: 11, multiplier: 2 }
    const other = findVenue('v-cendana')!
    const court = other.courts[0]!
    // Jam 10 bukan prime time bagi venue non-klub.
    expect(priceFor(other, court, 10)).toBe(other.pricePerHourIdr)
  })

  it('tarif khusus lapangan menang atas tarif dasar klub', () => {
    const venue = findVenue('v-dbtc')!
    const court = venue.courts[0]!
    court.pricePerHourIdr = 100_000
    expect(priceFor(venue, court, 10)).toBe(100_000)
  })
})

describe('applySettingsToVenue', () => {
  it('menyalin profil dan jam buka ke venue klub', () => {
    store.settings.name = 'DBTC Baru'
    store.settings.address = 'Jl. Contoh No. 1'
    store.settings.openHours = { open: 7, close: 21 }
    store.settings.basePricePerHourIdr = 90_000

    applySettingsToVenue()

    const venue = findVenue('v-dbtc')!
    expect(venue.name).toBe('DBTC Baru')
    expect(venue.address).toBe('Jl. Contoh No. 1')
    expect(venue.openHours).toEqual({ open: 7, close: 21 })
    expect(venue.pricePerHourIdr).toBe(90_000)
  })

  it('menurunkan daftar cabang dan status indoor dari lapangannya', () => {
    const venue = findVenue('v-dbtc')!
    venue.courts.push({
      id: 'v-dbtc-cx',
      venueId: 'v-dbtc',
      name: 'Lap. Indoor',
      sport: 'badminton',
      indoor: true,
      surface: 'Karpet vinyl',
    })

    applySettingsToVenue()

    expect(venue.indoor).toBe(true)
    expect(venue.sport).toContain('badminton')
    expect(venue.sport).toContain('tennis')
  })
})
