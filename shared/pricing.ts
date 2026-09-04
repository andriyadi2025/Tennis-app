import type { AddOn, Slot } from './types.ts'

/** Biaya layanan per booking — flat, ditampilkan terpisah di ringkasan. */
export const SERVICE_FEE_IDR = 5_000

export interface PriceBreakdown {
  courtIdr: number
  addOnsIdr: number
  subtotalIdr: number
  discountIdr: number
  serviceFeeIdr: number
  totalIdr: number
}

export interface PriceInput {
  slots: Slot[]
  addOns?: AddOn[]
  discountIdr?: number
  /** Jumlah minggu kalau jadwal berulang aktif (1 = tidak berulang). */
  weeks?: number
}

/**
 * Harga dihitung dari slot yang benar-benar dipilih, bukan dari
 * `venue.pricePerHourIdr × jam`: lapangan premium bisa punya tarif sendiri
 * dan slot prime-time boleh berbeda.
 */
export function computePrice({
  slots,
  addOns = [],
  discountIdr = 0,
  weeks = 1,
}: PriceInput): PriceBreakdown {
  const repeats = Math.max(1, Math.floor(weeks))
  const courtIdr = slots.reduce((sum, s) => sum + s.priceIdr, 0) * repeats
  const addOnsIdr = addOns.reduce((sum, a) => sum + a.priceIdr * a.qty, 0) * repeats
  const subtotalIdr = courtIdr + addOnsIdr
  // Diskon tidak boleh melebihi subtotal, dan tidak ada total negatif.
  const discount = Math.min(Math.max(0, Math.round(discountIdr)), subtotalIdr)
  const serviceFeeIdr = slots.length > 0 ? SERVICE_FEE_IDR : 0
  return {
    courtIdr,
    addOnsIdr,
    subtotalIdr,
    discountIdr: discount,
    serviceFeeIdr,
    totalIdr: subtotalIdr - discount + serviceFeeIdr,
  }
}
