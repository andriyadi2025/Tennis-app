import type { Booking, Court, Slot, Venue } from '@/types'
import { CHATS, NOTIFICATIONS, OPEN_MATCHES, REVIEWS, TEAMS, TOURNAMENTS, VENUES } from './seed'

/**
 * "Database" in-memory untuk MSW. Ketersediaan slot dihitung dari hash yang
 * deterministik, bukan Math.random(), supaya:
 *  · grid slot tidak berubah tiap render;
 *  · deteksi bentrok jadwal berulang bisa menjawab pertanyaan yang sama
 *    berkali-kali dengan jawaban yang sama.
 */

/** FNV-1a — cukup untuk menyebar slot terisi secara merata dan stabil. */
function hash(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Booking yang dibuat sesi ini — menutup slot yang tadinya kosong. */
const takenSlots = new Set<string>()
const bookings = new Map<string, Booking>()

export function slotId(courtId: string, startsAtIso: string): string {
  return `${courtId}|${startsAtIso}`
}

/**
 * Prime time (18.00–21.00) sengaja lebih padat, jam siang lebih longgar —
 * supaya grid terasa seperti venue sungguhan, bukan papan catur acak.
 */
function occupancyThreshold(hour: number): number {
  if (hour >= 18 && hour <= 21) return 0.55
  if (hour >= 15 && hour < 18) return 0.3
  if (hour >= 22) return 0.25
  return 0.18
}

export function isSlotAvailable(courtId: string, startsAtIso: string): boolean {
  if (takenSlots.has(slotId(courtId, startsAtIso))) return false
  const d = new Date(startsAtIso)
  const hour = d.getHours()
  const key = `${courtId}:${d.getFullYear()}-${d.getMonth()}-${d.getDate()}:${hour}`
  const ratio = (hash(key) % 1000) / 1000
  return ratio >= occupancyThreshold(hour)
}

export function priceFor(venue: Venue, court: Court, hour: number): number {
  const base = court.pricePerHourIdr ?? venue.pricePerHourIdr
  // Prime time 18.00–21.00 naik 20%, dibulatkan ke Rp1.000 terdekat.
  const isPrime = hour >= 18 && hour <= 21
  return isPrime ? Math.round((base * 1.2) / 1_000) * 1_000 : base
}

export function buildSlots(venue: Venue, court: Court, dayIso: string): Slot[] {
  const day = new Date(dayIso)
  day.setHours(0, 0, 0, 0)
  const { open, close } = venue.openHours
  const now = Date.now()
  const slots: Slot[] = []
  for (let hour = open; hour < close; hour += 1) {
    const starts = new Date(day)
    starts.setHours(hour, 0, 0, 0)
    const iso = starts.toISOString()
    // Jam yang sudah lewat diperlakukan sebagai penuh, bukan disembunyikan —
    // supaya grid tetap punya bentuk yang sama sepanjang hari.
    const past = starts.getTime() < now
    slots.push({
      courtId: court.id,
      startsAt: iso,
      status: past || !isSlotAvailable(court.id, iso) ? 'booked' : 'available',
      priceIdr: priceFor(venue, court, hour),
    })
  }
  return slots
}

export function findVenue(id: string): Venue | undefined {
  return VENUES.find((v) => v.id === id)
}

export function findCourt(venue: Venue, courtId: string): Court | undefined {
  return venue.courts.find((c) => c.id === courtId)
}

export function claimSlots(courtId: string, startsAt: readonly string[]): void {
  startsAt.forEach((iso) => takenSlots.add(slotId(courtId, iso)))
}

export function releaseSlots(courtId: string, startsAt: readonly string[]): void {
  startsAt.forEach((iso) => takenSlots.delete(slotId(courtId, iso)))
}

export function saveBooking(booking: Booking): void {
  bookings.set(booking.id, booking)
}

export function getBooking(id: string): Booking | undefined {
  return bookings.get(id)
}

export function listBookings(): Booking[] {
  return [...bookings.values()].sort(
    (a, b) => new Date(b.range.startsAt).getTime() - new Date(a.range.startsAt).getTime(),
  )
}

/**
 * Kasus error yang sengaja dipasang: satu slot "sial" yang selalu direbut
 * orang lain di antara ringkasan dan pembayaran. Dipakai untuk membuktikan
 * state error benar-benar tampil, bukan sekadar happy path.
 * Pemicunya: lapangan mana pun berakhiran `-c1` pada jam 21.00.
 */
export function isCursedSlot(courtId: string, startsAt: readonly string[]): boolean {
  if (!courtId.endsWith('-c1')) return false
  return startsAt.some((iso) => new Date(iso).getHours() === 21)
}

export const READ_ONLY = {
  venues: VENUES,
  reviews: REVIEWS,
  openMatches: OPEN_MATCHES,
  teams: TEAMS,
  tournaments: TOURNAMENTS,
  notifications: NOTIFICATIONS,
  chats: CHATS,
}

/**
 * Satu booking bawaan yang sudah lunas dan punya split bill berjalan.
 * Tanpa ini, kartu split bill di obrolan grup (layar 18) tidak punya apa pun
 * untuk ditampilkan sampai user menyelesaikan satu booking sendiri.
 */
function seedBooking(): Booking {
  const venue = VENUES[0]!
  const court = venue.courts[2]!
  const starts = new Date()
  starts.setDate(starts.getDate() + ((5 - starts.getDay() + 7) % 7 || 7))
  starts.setHours(19, 0, 0, 0)
  const ends = new Date(starts.getTime() + 2 * 3_600_000)
  const totalIdr = 161_000

  const participants = [
    { id: 'sp-host', name: 'Raka Pratama', isHost: true },
    { id: 'p-1', name: 'Dimas', isHost: false },
    { id: 'p-2', name: 'Rani', isHost: false },
    { id: 'p-3', name: 'Yoga', isHost: false },
    { id: 'p-4', name: 'Sarah', isHost: false },
    { id: 'p-5', name: 'Bagas', isHost: false },
  ]
  const amountPerPersonIdr = Math.floor(totalIdr / participants.length)

  return {
    id: 'bk-seed-1',
    venueId: venue.id,
    venueName: venue.name,
    courtId: court.id,
    courtName: court.name,
    sport: 'badminton',
    range: { startsAt: starts.toISOString(), endsAt: ends.toISOString(), hours: 2 },
    recurrence: null,
    addOns: [],
    splitBill: {
      participants,
      amountPerPersonIdr,
      hostRemainderIdr: totalIdr - amountPerPersonIdr * participants.length,
      // Tiga sudah bayar, tiga belum — supaya progres split bill terlihat.
      paidBy: ['sp-host', 'p-1', 'p-3'],
    },
    status: 'confirmed',
    paymentMethod: 'qris',
    code: 'LPG-K7M4XQ',
    subtotalIdr: 156_000,
    pointsRedeemed: 0,
    discountIdr: 0,
    serviceFeeIdr: 5_000,
    totalIdr,
    createdAt: new Date(Date.now() - 5 * 3_600_000).toISOString(),
    paymentDeadline: null,
  }
}

function seed(): void {
  const booking = seedBooking()
  bookings.set(booking.id, booking)
  claimSlots(booking.courtId, [
    booking.range.startsAt,
    new Date(new Date(booking.range.startsAt).getTime() + 3_600_000).toISOString(),
  ])
}

seed()

/** Dipakai tes supaya tiap kasus mulai dari state yang sama dengan app baru dimuat. */
export function resetDb(): void {
  takenSlots.clear()
  bookings.clear()
  seed()
}
