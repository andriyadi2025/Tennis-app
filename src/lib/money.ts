const idr = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
})

/** "Rp145.000" — dipakai di ringkasan, total, dan tabel harga. */
export function formatIdr(amount: number): string {
  // Intl menyisipkan NBSP setelah "Rp"; brief minta format rapat "Rp145.000".
  return idr.format(Math.round(amount)).replace(/\u00A0/g, '')
}

/**
 * "Rp65rb" — bentuk pendek untuk kartu venue dan chip harga.
 * Di bawah Rp1.000 tetap ditulis penuh; kelipatan juta jadi "Rp1,2jt".
 */
export function formatIdrShort(amount: number): string {
  const n = Math.round(amount)
  if (n >= 1_000_000) {
    const juta = n / 1_000_000
    const text = Number.isInteger(juta) ? String(juta) : juta.toFixed(1).replace('.', ',')
    return `Rp${text}jt`
  }
  if (n >= 1_000) {
    const ribu = n / 1_000
    const text = Number.isInteger(ribu) ? String(ribu) : ribu.toFixed(1).replace('.', ',')
    return `Rp${text}rb`
  }
  return `Rp${n}`
}

/** "1,2 km" / "850 m" */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km.toFixed(1).replace('.', ',')} km`
}
