import type { MerchItem, MerchPayMode, MerchVariant, User } from './types.ts'
import { pointsEarned } from './points.ts'

/**
 * Aturan toko, terpisah dari layar dan dari server tiruan.
 *
 * Keduanya memanggil fungsi yang sama: layar memakainya untuk menjelaskan
 * lebih dulu kenapa sebuah tombol mati, server memakainya sebagai penjaga
 * sungguhan. Kalau aturannya ditulis dua kali, yang satu akan ketinggalan —
 * dan yang ketinggalan biasanya yang di server.
 */

/**
 * Batas per pesanan. Bukan aturan bisnis yang rumit, cuma pagar: tanpa ini
 * satu orang bisa mengosongkan stok kaus dalam satu ketukan.
 */
export const MAX_QTY_PER_ORDER = 5

export function findVariant(item: MerchItem, variantId: string): MerchVariant | undefined {
  return item.variants.find((v) => v.id === variantId)
}

export function totalStock(item: MerchItem): number {
  return item.variants.reduce((sum, v) => sum + Math.max(0, v.stock), 0)
}

export function isSoldOut(item: MerchItem): boolean {
  return totalStock(item) === 0
}

/** Cara bayar yang benar-benar tersedia untuk barang ini. */
export function payModesFor(item: MerchItem): MerchPayMode[] {
  const modes: MerchPayMode[] = []
  if (item.priceIdr !== null) modes.push('uang')
  if (item.pricePoints !== null) modes.push('poin')
  return modes
}

export interface MerchQuote {
  qty: number
  payMode: MerchPayMode
  /** Total rupiah; 0 kalau ditebus poin. */
  totalIdr: number
  /** Poin yang dipotong; 0 kalau dibayar uang. */
  pointsSpent: number
  /** Poin belanja yang didapat; 0 kalau ditebus poin. */
  pointsEarned: number
}

/**
 * Menghitung tagihan satu pesanan.
 *
 * Menebus poin tidak menghasilkan poin. Kalau ia menghasilkan, tiap penebusan
 * mengembalikan sebagian ongkosnya dan saldo tidak pernah benar-benar turun.
 */
export function quoteOrder(item: MerchItem, qty: number, payMode: MerchPayMode): MerchQuote {
  const count = Math.max(1, Math.floor(qty))
  if (payMode === 'poin') {
    return {
      qty: count,
      payMode,
      totalIdr: 0,
      pointsSpent: (item.pricePoints ?? 0) * count,
      pointsEarned: 0,
    }
  }
  const totalIdr = (item.priceIdr ?? 0) * count
  return { qty: count, payMode, totalIdr, pointsSpent: 0, pointsEarned: pointsEarned(totalIdr) }
}

export interface OrderAttempt {
  item: MerchItem
  variantId: string
  qty: number
  payMode: MerchPayMode
  /** Saldo poin dan status keanggotaan pemesan. */
  user: Pick<User, 'points' | 'isMember'>
}

/**
 * Alasan sebuah pesanan tidak boleh jalan, atau null kalau boleh.
 *
 * Pesannya menyebut angka yang sebenarnya — "stok tinggal 2", bukan "stok
 * tidak cukup" — supaya orang tahu harus mengubah apa, bukan cuma bahwa
 * sesuatu salah.
 */
export function orderBlocker({ item, variantId, qty, payMode, user }: OrderAttempt): string | null {
  if (!item.active) return 'Barang ini sedang tidak dijual.'
  if (item.membersOnly && !user.isMember) {
    return 'Barang ini khusus anggota berbayar DBTC.'
  }

  const variant = findVariant(item, variantId)
  if (!variant) return 'Pilih dulu ukuran atau variannya.'

  const count = Math.floor(qty)
  if (count < 1) return 'Jumlah minimal 1.'
  if (count > MAX_QTY_PER_ORDER) return `Maksimal ${MAX_QTY_PER_ORDER} per pesanan.`
  if (variant.stock <= 0) return `Varian ${variant.label} sedang habis.`
  if (count > variant.stock) {
    return `Stok ${variant.label} tinggal ${variant.stock}.`
  }

  if (payMode === 'poin') {
    if (item.pricePoints === null) return 'Barang ini tidak bisa ditukar dengan poin.'
    const needed = item.pricePoints * count
    if (user.points < needed) {
      return `Poin kamu kurang ${(needed - user.points).toLocaleString('id-ID')}.`
    }
  } else {
    if (item.priceIdr === null) return 'Barang ini hanya bisa ditukar dengan poin.'
  }

  return null
}

/** Stok setelah pesanan dipotong — dipakai server saat menyimpan. */
export function decrementStock(item: MerchItem, variantId: string, qty: number): MerchItem {
  return {
    ...item,
    variants: item.variants.map((v) =>
      v.id === variantId ? { ...v, stock: Math.max(0, v.stock - qty) } : v,
    ),
  }
}

/**
 * Stok dikembalikan saat pesanan dibatalkan. Tanpa ini, tiap pembatalan
 * diam-diam membuang satu barang dari katalog.
 */
export function restoreStock(item: MerchItem, variantId: string, qty: number): MerchItem {
  return {
    ...item,
    variants: item.variants.map((v) => (v.id === variantId ? { ...v, stock: v.stock + qty } : v)),
  }
}
