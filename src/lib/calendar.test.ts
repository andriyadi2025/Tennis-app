import { describe, expect, it } from 'vitest'
import type { Booking } from '@/types'
import { bookingToIcs, escapeIcsText, foldIcsLine, toIcsStamp } from './calendar'

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'bk-1',
    venueId: 'v-cendana',
    venueName: 'GOR Cendana',
    courtId: 'v-cendana-c3',
    courtName: 'Lap. 3',
    sport: 'badminton',
    range: {
      startsAt: '2026-08-29T12:00:00.000Z',
      endsAt: '2026-08-29T14:00:00.000Z',
      hours: 2,
    },
    recurrence: null,
    addOns: [],
    splitBill: null,
    status: 'confirmed',
    paymentMethod: 'qris',
    code: 'LPG-ABC123',
    subtotalIdr: 156_000,
    pointsRedeemed: 0,
    discountIdr: 0,
    serviceFeeIdr: 5_000,
    totalIdr: 161_000,
    createdAt: '2026-08-26T04:00:00.000Z',
    paymentDeadline: null,
    ...overrides,
  }
}

describe('toIcsStamp', () => {
  it('membuang pemisah dan milidetik, menyisakan UTC', () => {
    expect(toIcsStamp('2026-08-29T12:00:00.000Z')).toBe('20260829T120000Z')
  })
})

describe('escapeIcsText', () => {
  it('meng-escape koma, titik-koma, dan garis miring terbalik', () => {
    expect(escapeIcsText('a,b;c\\d')).toBe('a\\,b\\;c\\\\d')
  })

  it('mengubah baris baru jadi \\n literal', () => {
    expect(escapeIcsText('baris satu\nbaris dua')).toBe('baris satu\\nbaris dua')
  })

  it('membiarkan teks biasa apa adanya', () => {
    expect(escapeIcsText('GOR Cendana')).toBe('GOR Cendana')
  })
})

describe('foldIcsLine', () => {
  it('membiarkan baris pendek tanpa lipatan', () => {
    expect(foldIcsLine('SUMMARY:Main badminton')).toBe('SUMMARY:Main badminton')
  })

  it('melipat baris panjang dengan spasi di awal sambungan', () => {
    const long = `DESCRIPTION:${'a'.repeat(200)}`
    const folded = foldIcsLine(long)
    expect(folded).toContain('\r\n ')
    folded.split('\r\n').forEach((line, i) => {
      // Baris pertama boleh 75 oktet; sambungannya 74 + satu spasi awal.
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
      if (i > 0) expect(line.startsWith(' ')).toBe(true)
    })
  })

  it('menghitung batas dalam oktet, bukan jumlah karakter', () => {
    // Tiap emoji 4 oktet: 30 karakter tapi 120 oktet, harus tetap dilipat.
    const folded = foldIcsLine(`X:${'😀'.repeat(30)}`)
    folded.split('\r\n').forEach((line) => {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    })
  })
})

describe('bookingToIcs', () => {
  const now = new Date('2026-08-26T04:00:00.000Z')

  it('menghasilkan satu VEVENT yang tertutup rapi', () => {
    const ics = bookingToIcs(booking(), now)
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('END:VEVENT')
    expect(ics.endsWith('END:VCALENDAR')).toBe(true)
  })

  it('memakai waktu mulai dan selesai booking', () => {
    const ics = bookingToIcs(booking(), now)
    expect(ics).toContain('DTSTART:20260829T120000Z')
    expect(ics).toContain('DTEND:20260829T140000Z')
  })

  it('memakai kode booking sebagai UID supaya tidak menggandakan acara', () => {
    expect(bookingToIcs(booking(), now)).toContain('UID:LPG-ABC123@lapangin.app')
  })

  it('memasang pengingat satu jam sebelum main', () => {
    const ics = bookingToIcs(booking(), now)
    expect(ics).toContain('BEGIN:VALARM')
    expect(ics).toContain('TRIGGER:-PT1H')
  })

  it('menambahkan RRULE hanya kalau booking berulang', () => {
    expect(bookingToIcs(booking(), now)).not.toContain('RRULE')
    const berulang = bookingToIcs(booking({ recurrence: { weekly: true, weeks: 4 } }), now)
    expect(berulang).toContain('RRULE:FREQ=WEEKLY;COUNT=4')
  })

  it('meng-escape nama venue yang mengandung koma', () => {
    const ics = bookingToIcs(booking({ venueName: 'GOR Cendana, Sukajadi' }), now)
    expect(ics).toContain('LOCATION:GOR Cendana\\, Sukajadi')
  })

  it('memakai CRLF sebagai pemisah baris', () => {
    const ics = bookingToIcs(booking(), now)
    expect(ics.split('\r\n').length).toBeGreaterThan(10)
    // Tidak boleh ada LF yang berdiri sendiri tanpa CR.
    expect(/[^\r]\n/.test(ics)).toBe(false)
  })
})
