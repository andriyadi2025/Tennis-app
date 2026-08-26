import { describe, expect, it } from 'vitest'
import type { Slot } from '@/types'
import { SERVICE_FEE_IDR, computePrice } from './pricing'

function slot(startsAt: string, priceIdr: number): Slot {
  return { courtId: 'c1', startsAt, status: 'available', priceIdr }
}

describe('computePrice', () => {
  it('menjumlah harga tiap slot, bukan mengalikan tarif venue', () => {
    // Slot prime time lebih mahal — total harus mencerminkan itu.
    const result = computePrice({
      slots: [slot('2026-08-29T12:00:00.000Z', 65_000), slot('2026-08-29T13:00:00.000Z', 78_000)],
    })
    expect(result.courtIdr).toBe(143_000)
    expect(result.subtotalIdr).toBe(143_000)
    expect(result.totalIdr).toBe(143_000 + SERVICE_FEE_IDR)
  })

  it('mengalikan lapangan dan add-on dengan jumlah minggu berulang', () => {
    const result = computePrice({
      slots: [slot('2026-08-29T12:00:00.000Z', 65_000)],
      addOns: [{ id: 'a', label: 'Shuttlecock', priceIdr: 95_000, qty: 1 }],
      weeks: 4,
    })
    expect(result.courtIdr).toBe(260_000)
    expect(result.addOnsIdr).toBe(380_000)
    expect(result.subtotalIdr).toBe(640_000)
  })

  it('menghitung add-on sesuai kuantitasnya', () => {
    const result = computePrice({
      slots: [slot('2026-08-29T12:00:00.000Z', 50_000)],
      addOns: [{ id: 'a', label: 'Rompi', priceIdr: 30_000, qty: 3 }],
    })
    expect(result.addOnsIdr).toBe(90_000)
  })

  it('tidak pernah menghasilkan total negatif walau diskon berlebihan', () => {
    const result = computePrice({
      slots: [slot('2026-08-29T12:00:00.000Z', 50_000)],
      discountIdr: 999_999,
    })
    expect(result.discountIdr).toBe(50_000)
    expect(result.totalIdr).toBe(SERVICE_FEE_IDR)
  })

  it('tidak membebankan biaya layanan kalau belum ada slot dipilih', () => {
    const result = computePrice({ slots: [] })
    expect(result.serviceFeeIdr).toBe(0)
    expect(result.totalIdr).toBe(0)
  })

  it('memperlakukan weeks di bawah 1 sebagai sekali booking', () => {
    const result = computePrice({ slots: [slot('2026-08-29T12:00:00.000Z', 65_000)], weeks: 0 })
    expect(result.courtIdr).toBe(65_000)
  })
})
