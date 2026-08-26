import type { Booking } from '@/types'
import { SPORT_LABEL } from '@/types'

/**
 * Berkas .ics dibangun sendiri, bukan lewat pustaka: formatnya sempit dan
 * ketat, dan satu-satunya bagian yang benar-benar mudah salah — escaping dan
 * lipatan baris — justru yang perlu diuji.
 */

/** Waktu ICS selalu UTC dengan sufiks Z: 20260829T120000Z. */
export function toIcsStamp(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/**
 * RFC 5545 §3.3.11: koma, titik-koma, dan garis miring terbalik harus
 * di-escape, dan baris baru jadi literal `\n`.
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * RFC 5545 §3.1: baris tidak boleh lebih dari 75 oktet; sambungannya diawali
 * satu spasi. Kalkulasi pakai panjang oktet, bukan jumlah karakter, supaya
 * nama venue beraksen tidak diam-diam melewati batas.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line

  const parts: string[] = []
  let current = ''
  let currentBytes = 0
  // Batas 74 oktet untuk baris sambungan, menyisakan ruang bagi spasi awal.
  for (const char of line) {
    const size = encoder.encode(char).length
    const limit = parts.length === 0 ? 75 : 74
    if (currentBytes + size > limit) {
      parts.push(current)
      current = char
      currentBytes = size
    } else {
      current += char
      currentBytes += size
    }
  }
  if (current) parts.push(current)
  return parts.join('\r\n ')
}

export function bookingToIcs(booking: Booking, now: Date = new Date()): string {
  const summary = `Main ${SPORT_LABEL[booking.sport]} di ${booking.venueName}`
  const description = [
    `Lapangan: ${booking.courtName}`,
    `Kode booking: ${booking.code}`,
    booking.recurrence ? `Berulang mingguan, ${booking.recurrence.weeks} minggu` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dukuh Bima Tennis Club//Booking//ID',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${booking.code}@dbtc.id`,
    `DTSTAMP:${toIcsStamp(now.toISOString())}`,
    `DTSTART:${toIcsStamp(booking.range.startsAt)}`,
    `DTEND:${toIcsStamp(booking.range.endsAt)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(booking.venueName)}`,
    // Pengingat 1 jam sebelum main.
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcsText(summary)}`,
    'END:VALARM',
  ]

  if (booking.recurrence) {
    lines.splice(-5, 0, `RRULE:FREQ=WEEKLY;COUNT=${booking.recurrence.weeks}`)
  }

  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.map(foldIcsLine).join('\r\n')
}

/** Memicu unduhan .ics di peramban. */
export function downloadIcs(booking: Booking): void {
  const blob = new Blob([bookingToIcs(booking)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `dbtc-${booking.code}.ics`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
