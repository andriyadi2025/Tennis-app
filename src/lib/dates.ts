import { format, parseISO, addHours, addWeeks, startOfDay, isSameDay } from 'date-fns'
import { id } from 'date-fns/locale'

export { addHours, addWeeks, startOfDay, isSameDay, parseISO }

/** "Jum, 29 Agu" */
export function formatDateShort(iso: string | Date): string {
  const d = typeof iso === 'string' ? parseISO(iso) : iso
  return format(d, 'EEE, d MMM', { locale: id })
}

/** "Jumat, 29 Agustus 2026" */
export function formatDateLong(iso: string | Date): string {
  const d = typeof iso === 'string' ? parseISO(iso) : iso
  return format(d, 'EEEE, d MMMM yyyy', { locale: id })
}

/** "19.00" — jam gaya Indonesia, pemisah titik. */
export function formatHour(iso: string | Date): string {
  const d = typeof iso === 'string' ? parseISO(iso) : iso
  return format(d, 'HH.mm')
}

/** "19.00 – 21.00" */
export function formatHourRange(startIso: string, endIso: string): string {
  return `${formatHour(startIso)} – ${formatHour(endIso)}`
}

/** "Jum" */
export function formatWeekdayShort(iso: string | Date): string {
  const d = typeof iso === 'string' ? parseISO(iso) : iso
  return format(d, 'EEE', { locale: id })
}

/** "Jumat" — dipakai di label "Ulangi tiap Jumat". */
export function formatWeekdayLong(iso: string | Date): string {
  const d = typeof iso === 'string' ? parseISO(iso) : iso
  return format(d, 'EEEE', { locale: id })
}

/**
 * "Juli 2025" — untuk tanggal yang jauh di belakang, seperti "Anggota sejak".
 * Format harian tanpa tahun akan menyesatkan di rentang selama itu.
 */
export function formatMonthYear(iso: string | Date): string {
  const d = typeof iso === 'string' ? parseISO(iso) : iso
  return format(d, 'MMMM yyyy', { locale: id })
}

/** "29" */
export function formatDayOfMonth(iso: string | Date): string {
  const d = typeof iso === 'string' ? parseISO(iso) : iso
  return format(d, 'dd')
}

/** Kunci hari untuk query & perbandingan: "2026-08-29". */
export function dayKey(iso: string | Date): string {
  const d = typeof iso === 'string' ? parseISO(iso) : iso
  return format(d, 'yyyy-MM-dd')
}

/** Strip 14 hari mulai dari `from`. */
export function dateStrip(from: Date, days = 14): Date[] {
  const base = startOfDay(from)
  return Array.from({ length: days }, (_, i) => new Date(base.getTime() + i * 86_400_000))
}

/** "09:58" — sisa waktu untuk countdown pembayaran. */
export function formatCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.floor(msRemaining / 1000))
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

/** "2 jam lalu" / "Kemarin" — untuk notifikasi & chat. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = parseISO(iso)
  const diffMin = Math.round((now.getTime() - then.getTime()) / 60_000)
  if (diffMin < 1) return 'Baru saja'
  if (diffMin < 60) return `${diffMin} menit lalu`
  const diffHour = Math.round(diffMin / 60)
  if (diffHour < 24) return `${diffHour} jam lalu`
  const diffDay = Math.round(diffHour / 24)
  if (diffDay === 1) return 'Kemarin'
  if (diffDay < 7) return `${diffDay} hari lalu`
  return formatDateShort(iso)
}
