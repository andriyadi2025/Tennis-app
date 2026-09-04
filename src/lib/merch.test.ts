import { describe, expect, it } from 'vitest'
import type { MerchItem } from '@/types'
import {
  MAX_QTY_PER_ORDER,
  decrementStock,
  isSoldOut,
  orderBlocker,
  payModesFor,
  quoteOrder,
  restoreStock,
  totalStock,
} from './merch'

function item(overrides: Partial<MerchItem> = {}): MerchItem {
  return {
    id: 'm-kaus',
    name: 'Kaus latihan DBTC',
    category: 'apparel',
    description: 'Dry-fit, logo bordir.',
    photo: { tone: 'accent', step: 300, seed: 3 },
    priceIdr: 180_000,
    pricePoints: 1_200,
    variants: [
      { id: 'v-m', label: 'M', stock: 4 },
      { id: 'v-l', label: 'L', stock: 0 },
    ],
    membersOnly: false,
    active: true,
    ...overrides,
  }
}

const KAYA = { points: 10_000, isMember: true }
const MISKIN = { points: 50, isMember: true }

describe('stok', () => {
  it('menjumlahkan stok seluruh varian', () => {
    expect(totalStock(item())).toBe(4)
    expect(isSoldOut(item())).toBe(false)
  })

  it('menganggap habis kalau semua varian nol', () => {
    const kosong = item({ variants: [{ id: 'v-m', label: 'M', stock: 0 }] })
    expect(isSoldOut(kosong)).toBe(true)
  })

  it('memotong stok hanya pada varian yang dipesan', () => {
    const after = decrementStock(item(), 'v-m', 3)
    expect(after.variants.map((v) => v.stock)).toEqual([1, 0])
  })

  it('tidak pernah membuat stok negatif', () => {
    expect(decrementStock(item(), 'v-m', 99).variants[0]?.stock).toBe(0)
  })

  it('mengembalikan stok saat pesanan dibatalkan', () => {
    // Tanpa ini tiap pembatalan diam-diam membuang barang dari katalog.
    const dipesan = decrementStock(item(), 'v-m', 2)
    expect(restoreStock(dipesan, 'v-m', 2).variants[0]?.stock).toBe(4)
  })
})

describe('cara bayar', () => {
  it('menawarkan keduanya kalau dua harga terisi', () => {
    expect(payModesFor(item())).toEqual(['uang', 'poin'])
  })

  it('hanya poin kalau tidak dijual dengan uang', () => {
    expect(payModesFor(item({ priceIdr: null }))).toEqual(['poin'])
  })

  it('hanya uang kalau tidak bisa ditukar poin', () => {
    expect(payModesFor(item({ pricePoints: null }))).toEqual(['uang'])
  })
})

describe('quoteOrder', () => {
  it('mengalikan harga rupiah dengan jumlah dan memberi poin belanja', () => {
    const quote = quoteOrder(item(), 2, 'uang')
    expect(quote.totalIdr).toBe(360_000)
    expect(quote.pointsSpent).toBe(0)
    // 1 poin per Rp1.000, aturan yang sama dengan booking.
    expect(quote.pointsEarned).toBe(360)
  })

  it('tidak memberi poin untuk penebusan poin', () => {
    const quote = quoteOrder(item(), 2, 'poin')
    expect(quote.pointsSpent).toBe(2_400)
    expect(quote.totalIdr).toBe(0)
    // Kalau menebus poin ikut menghasilkan poin, saldo tidak pernah turun.
    expect(quote.pointsEarned).toBe(0)
  })
})

describe('orderBlocker', () => {
  const boleh = { item: item(), variantId: 'v-m', qty: 1, payMode: 'uang' as const, user: KAYA }

  it('meloloskan pesanan yang wajar', () => {
    expect(orderBlocker(boleh)).toBeNull()
  })

  it('menolak barang nonaktif', () => {
    expect(orderBlocker({ ...boleh, item: item({ active: false }) })).toMatch(/tidak dijual/)
  })

  it('menolak barang khusus anggota untuk bukan anggota', () => {
    const khusus = item({ membersOnly: true })
    expect(
      orderBlocker({ ...boleh, item: khusus, user: { points: 9_999, isMember: false } }),
    ).toMatch(/khusus anggota/)
    expect(orderBlocker({ ...boleh, item: khusus })).toBeNull()
  })

  it('menolak varian yang tidak ada atau belum dipilih', () => {
    expect(orderBlocker({ ...boleh, variantId: '' })).toMatch(/Pilih dulu/)
  })

  it('menyebut sisa stok, bukan sekadar bilang kurang', () => {
    // Orang perlu tahu harus mengubah apa, bukan cuma bahwa ada yang salah.
    expect(orderBlocker({ ...boleh, qty: 5 })).toBe('Stok M tinggal 4.')
  })

  it('menolak varian yang habis', () => {
    expect(orderBlocker({ ...boleh, variantId: 'v-l' })).toMatch(/habis/)
  })

  it('menahan borongan lewat batas per pesanan', () => {
    const banyak = item({ variants: [{ id: 'v-m', label: 'M', stock: 99 }] })
    expect(orderBlocker({ ...boleh, item: banyak, qty: MAX_QTY_PER_ORDER })).toBeNull()
    expect(orderBlocker({ ...boleh, item: banyak, qty: MAX_QTY_PER_ORDER + 1 })).toMatch(/Maksimal/)
  })

  it('menolak jumlah nol atau negatif', () => {
    expect(orderBlocker({ ...boleh, qty: 0 })).toMatch(/minimal 1/)
  })

  it('menolak tukar poin kalau saldo kurang, sambil menyebut kekurangannya', () => {
    expect(orderBlocker({ ...boleh, payMode: 'poin', user: MISKIN })).toBe(
      'Poin kamu kurang 1.150.',
    )
  })

  it('menolak cara bayar yang memang tidak disediakan barangnya', () => {
    expect(orderBlocker({ ...boleh, item: item({ pricePoints: null }), payMode: 'poin' })).toMatch(
      /tidak bisa ditukar/,
    )
    expect(orderBlocker({ ...boleh, item: item({ priceIdr: null }), payMode: 'uang' })).toMatch(
      /hanya bisa ditukar dengan poin/,
    )
  })
})
