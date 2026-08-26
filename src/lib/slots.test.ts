import { describe, expect, it } from 'vitest'
import type { Slot } from '@/types'
import {
  bookableWeeks,
  findRecurrenceConflicts,
  isContiguous,
  slotKey,
  toRange,
  toggleSlot,
} from './slots'

/** Jam lokal 2026-08-29 (Jumat) supaya perbandingan minggu bisa diprediksi. */
function at(hour: number, day = 29): string {
  return new Date(2026, 7, day, hour, 0, 0, 0).toISOString()
}

const SLOTS: Slot[] = [15, 16, 17, 18, 19, 20, 21].map((h) => ({
  courtId: 'c1',
  startsAt: at(h),
  // 15.00 dan 18.00 sengaja penuh, untuk menguji slot yang tidak bisa dipilih.
  status: h === 15 || h === 18 ? 'booked' : 'available',
  priceIdr: 65_000,
}))

describe('isContiguous', () => {
  it('menerima daftar kosong dan satu slot', () => {
    expect(isContiguous([])).toBe(true)
    expect(isContiguous([at(19)])).toBe(true)
  })

  it('menerima jam yang berurutan', () => {
    expect(isContiguous([at(19), at(20), at(21)])).toBe(true)
  })

  it('menerima urutan acak selama jamnya bersambung', () => {
    expect(isContiguous([at(21), at(19), at(20)])).toBe(true)
  })

  it('menolak jam yang ada lubangnya', () => {
    expect(isContiguous([at(19), at(21)])).toBe(false)
  })
})

describe('toggleSlot', () => {
  const available = (h: number) => SLOTS.find((s) => s.startsAt === at(h))!

  it('memilih slot pertama tanpa syarat', () => {
    const result = toggleSlot([], available(19).startsAt, SLOTS)
    expect(result.error).toBeNull()
    expect(result.selected).toEqual([at(19)])
  })

  it('menolak slot yang sudah penuh', () => {
    const result = toggleSlot([], at(18), SLOTS)
    expect(result.error?.kind).toBe('booked')
    expect(result.selected).toEqual([])
  })

  it('menerima slot yang menempel di ujung atas', () => {
    const result = toggleSlot([at(19)], at(20), SLOTS)
    expect(result.error).toBeNull()
    expect(result.selected).toEqual([at(19), at(20)])
  })

  it('menerima slot yang menempel di ujung bawah', () => {
    const result = toggleSlot([at(20)], at(19), SLOTS)
    expect(result.error).toBeNull()
    expect(result.selected).toEqual([at(19), at(20)])
  })

  it('menolak slot yang tidak bersambung', () => {
    const result = toggleSlot([at(19)], at(21), SLOTS)
    expect(result.error?.kind).toBe('notContiguous')
    expect(result.selected).toEqual([at(19)])
  })

  it('melepas slot di ujung', () => {
    const result = toggleSlot([at(19), at(20), at(21)], at(21), SLOTS)
    expect(result.error).toBeNull()
    expect(result.selected).toEqual([at(19), at(20)])
  })

  it('menolak melepas slot di tengah supaya blok tidak terbelah', () => {
    const result = toggleSlot([at(19), at(20), at(21)], at(20), SLOTS)
    expect(result.error?.kind).toBe('breaksBlock')
    expect(result.selected).toEqual([at(19), at(20), at(21)])
  })

  it('menolak slot yang tidak ada di grid', () => {
    const result = toggleSlot([], at(3), SLOTS)
    expect(result.error?.kind).toBe('booked')
  })
})

describe('toRange', () => {
  it('mengembalikan null kalau belum ada pilihan', () => {
    expect(toRange([])).toBeNull()
  })

  it('menutup rentang satu jam setelah slot terakhir', () => {
    const range = toRange([at(19), at(20)])
    expect(range?.startsAt).toBe(at(19))
    expect(range?.endsAt).toBe(at(21))
    expect(range?.hours).toBe(2)
  })
})

describe('findRecurrenceConflicts', () => {
  /** Semua slot kosong kecuali yang didaftarkan sebagai terisi. */
  function lookup(taken: string[]) {
    const set = new Set(taken)
    return (courtId: string, iso: string) => !set.has(slotKey(courtId, iso))
  }

  it('tidak melaporkan apa-apa kalau tidak berulang', () => {
    expect(findRecurrenceConflicts('c1', [at(19)], 1, lookup([]))).toEqual([])
  })

  it('tidak melaporkan apa-apa kalau semua minggu ke depan kosong', () => {
    expect(findRecurrenceConflicts('c1', [at(19), at(20)], 4, lookup([]))).toEqual([])
  })

  it('melaporkan minggu yang slotnya sudah terisi', () => {
    // Minggu ke-2 (offset 2) jam 20.00 sudah dipakai orang lain.
    const clash = slotKey('c1', new Date(2026, 7, 29 + 14, 20, 0, 0, 0).toISOString())
    const conflicts = findRecurrenceConflicts('c1', [at(19), at(20)], 4, lookup([clash]))
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.weekOffset).toBe(2)
    expect(conflicts[0]?.hours).toEqual(['20.00'])
  })

  it('tidak pernah mengecek minggu pertama — itu booking aslinya', () => {
    const clash = slotKey('c1', at(19))
    expect(findRecurrenceConflicts('c1', [at(19)], 4, lookup([clash]))).toEqual([])
  })

  it('melaporkan tiap minggu yang bermasalah secara terpisah', () => {
    const week1 = slotKey('c1', new Date(2026, 7, 29 + 7, 19, 0, 0, 0).toISOString())
    const week3 = slotKey('c1', new Date(2026, 7, 29 + 21, 19, 0, 0, 0).toISOString())
    const conflicts = findRecurrenceConflicts('c1', [at(19)], 4, lookup([week1, week3]))
    expect(conflicts.map((c) => c.weekOffset)).toEqual([1, 3])
  })
})

describe('bookableWeeks', () => {
  it('mengembalikan seluruh minggu kalau tidak ada bentrok', () => {
    expect(bookableWeeks(4, [])).toBe(4)
  })

  it('berhenti di bentrokan pertama', () => {
    expect(
      bookableWeeks(4, [
        { weekOffset: 3, date: '2026-09-19', hours: ['19.00'] },
        { weekOffset: 2, date: '2026-09-12', hours: ['19.00'] },
      ]),
    ).toBe(2)
  })
})
