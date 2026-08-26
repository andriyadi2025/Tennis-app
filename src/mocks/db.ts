import type {
  AppNotification,
  Booking,
  ChatThread,
  Court,
  OpenMatch,
  Review,
  PrimeTime,
  Slot,
  SparringInvite,
  Team,
  Tournament,
  TournamentRegistration,
  Venue,
} from '@/types'
import {
  CHATS,
  CLUB_SETTINGS,
  NOTIFICATIONS,
  OPEN_MATCHES,
  REVIEWS,
  SPARRING,
  TEAMS,
  TOURNAMENTS,
  VENUES,
} from './seed'
import { readJson, remove, writeJson } from '@/lib/storage'

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

/**
 * Aturan prime time dulu ditanam di sini. Sekarang datang dari pengaturan
 * klub supaya admin bisa mengubahnya sendiri — venue lain (yang bukan milik
 * klub) tetap memakai aturan bawaan yang sama seperti sebelumnya.
 */
const DEFAULT_PRIME: PrimeTime = { from: 18, to: 21, multiplier: 1.2 }

function primeTimeFor(venueId: string): PrimeTime {
  return venueId === store.settings.venueId ? store.settings.primeTime : DEFAULT_PRIME
}

/** Jendela prime time boleh melewati tengah malam, mis. 20.00–01.00. */
export function isPrimeHour(hour: number, prime: PrimeTime): boolean {
  if (prime.from <= prime.to) return hour >= prime.from && hour <= prime.to
  return hour >= prime.from || hour <= prime.to
}

export function priceFor(venue: Venue, court: Court, hour: number): number {
  const base = court.pricePerHourIdr ?? venue.pricePerHourIdr
  const prime = primeTimeFor(venue.id)
  // Dibulatkan ke Rp1.000 terdekat — harga lapangan tidak pernah berkoma.
  return isPrimeHour(hour, prime) ? Math.round((base * prime.multiplier) / 1_000) * 1_000 : base
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
  return store.venues.find((v) => v.id === id)
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

/**
 * Koleksi yang bisa berubah selama sesi: gabung open match, tandai notifikasi
 * dibaca, tulis ulasan, daftar turnamen. Isinya salinan dari `seed.ts`, bukan
 * array seed itu sendiri — kalau seed dimutasi langsung, `resetDb()` tidak
 * akan pernah benar-benar mengembalikan keadaan awal dan tes akan saling
 * mencemari lewat state modul.
 */
export const store = {
  venues: [] as Venue[],
  reviews: [] as Review[],
  openMatches: [] as OpenMatch[],
  teams: [] as Team[],
  tournaments: [] as Tournament[],
  notifications: [] as AppNotification[],
  chats: [] as ChatThread[],
  sparring: [] as SparringInvite[],
  /** Pengaturan klub yang bisa diubah admin lewat dasbor. */
  settings: structuredClone(CLUB_SETTINGS),
}

/** Tim dan turnamen yang sudah diikuti user di sesi ini. */
const joinedTeams = new Set<string>()
const registeredTournaments = new Set<string>()
const registrations = new Map<string, TournamentRegistration>()

export function saveRegistration(registration: TournamentRegistration): void {
  registrations.set(registration.id, registration)
}

export function listRegistrations(): TournamentRegistration[] {
  return [...registrations.values()].sort(
    (a, b) => new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime(),
  )
}

export function findRegistration(tournamentId: string): TournamentRegistration | undefined {
  return [...registrations.values()].find((r) => r.tournamentId === tournamentId)
}

export const membership = {
  hasJoinedTeam: (id: string) => joinedTeams.has(id),
  joinTeam: (id: string) => joinedTeams.add(id),
  hasRegistered: (id: string) => registeredTournaments.has(id),
  register: (id: string) => registeredTournaments.add(id),
}

function loadCollections(): void {
  store.venues = structuredClone(VENUES)
  store.reviews = structuredClone(REVIEWS)
  store.openMatches = structuredClone(OPEN_MATCHES)
  store.teams = structuredClone(TEAMS)
  store.tournaments = structuredClone(TOURNAMENTS)
  store.notifications = structuredClone(NOTIFICATIONS)
  store.chats = structuredClone(CHATS)
  store.sparring = structuredClone(SPARRING)
  store.settings = structuredClone(CLUB_SETTINGS)
  joinedTeams.clear()
  registeredTournaments.clear()
}

/**
 * Rating venue dihitung ulang dari ulasan yang benar-benar ada, supaya angka
 * di kartu venue tidak bertentangan dengan daftar ulasannya sendiri setelah
 * user menambah ulasan baru.
 */
export function recomputeVenueRating(venueId: string): void {
  const venue = store.venues.find((v) => v.id === venueId)
  if (!venue) return
  const own = store.reviews.filter((r) => r.venueId === venueId)
  if (own.length === 0) return
  const average = own.reduce((sum, r) => sum + r.rating, 0) / own.length
  venue.rating = Math.round(average * 10) / 10
  venue.reviewCount = own.length
}

/**
 * Menerapkan pengaturan klub ke venue miliknya. Tanpa ini, mengubah jam buka
 * di dasbor tidak akan terlihat di layar pilih jadwal — dua sumber kebenaran
 * untuk hal yang sama adalah cara paling cepat membuat keduanya salah.
 */
export function applySettingsToVenue(): void {
  const venue = store.venues.find((v) => v.id === store.settings.venueId)
  if (!venue) return
  venue.name = store.settings.name
  venue.address = store.settings.address
  venue.district = store.settings.district
  venue.openHours = { ...store.settings.openHours }
  venue.pricePerHourIdr = store.settings.basePricePerHourIdr
  venue.indoor = venue.courts.some((c) => c.indoor)
  venue.sport = [...new Set(venue.courts.map((c) => c.sport))]
}

/**
 * Satu booking bawaan yang sudah lunas dan punya split bill berjalan.
 * Tanpa ini, kartu split bill di obrolan grup (layar 18) tidak punya apa pun
 * untuk ditampilkan sampai user menyelesaikan satu booking sendiri.
 */
function seedBooking(): Booking {
  // Dicari lewat id, bukan posisi: urutan venue berubah begitu venue klub
  // ditambahkan di depan, dan indeks diam-diam menunjuk ke yang salah.
  const venue = store.venues.find((v) => v.id === 'v-cendana') ?? store.venues[0]!
  const court = venue.courts[2] ?? venue.courts[0]!
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
    code: 'DBTC-K7M4XQ',
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
  loadCollections()
  registrations.clear()
  const booking = seedBooking()
  bookings.set(booking.id, booking)
  claimSlots(booking.courtId, [
    booking.range.startsAt,
    new Date(new Date(booking.range.startsAt).getTime() + 3_600_000).toISOString(),
  ])
}

/* ── Persistensi ──────────────────────────────────────────────────────────
 * Tanpa ini, booking dan segala aksi hilang tiap halaman dimuat ulang, dan
 * app terasa seperti demo yang lupa ingatan. Isinya tetap in-memory saat
 * berjalan; localStorage hanya dipakai supaya bertahan antar reload.
 * ──────────────────────────────────────────────────────────────────────── */

const SNAPSHOT_KEY = 'mock-db'
/** Naikkan kalau bentuk data berubah, supaya snapshot lama dibuang. */
const SNAPSHOT_VERSION = 1

interface Snapshot {
  version: number
  /** Tanggal snapshot dibuat. Data seed relatif terhadap "hari ini", jadi
   *  snapshot dari hari lain sudah basi dan harus dibuang, bukan dipulihkan. */
  day: string
  takenSlots: string[]
  bookings: Booking[]
  registrations: TournamentRegistration[]
  joinedTeams: string[]
  registeredTournaments: string[]
  store: typeof store
}

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function persistDb(): void {
  writeJson(SNAPSHOT_KEY, {
    version: SNAPSHOT_VERSION,
    day: todayKey(),
    takenSlots: [...takenSlots],
    bookings: [...bookings.values()],
    registrations: [...registrations.values()],
    joinedTeams: [...joinedTeams],
    registeredTournaments: [...registeredTournaments],
    store,
  } satisfies Snapshot)
}

function restoreDb(): boolean {
  const snapshot = readJson<Snapshot | null>(SNAPSHOT_KEY, null)
  if (!snapshot) return false
  if (snapshot.version !== SNAPSHOT_VERSION || snapshot.day !== todayKey()) {
    remove(SNAPSHOT_KEY)
    return false
  }
  try {
    Object.assign(store, snapshot.store)
    snapshot.takenSlots.forEach((s) => takenSlots.add(s))
    snapshot.bookings.forEach((b) => bookings.set(b.id, b))
    snapshot.registrations.forEach((r) => registrations.set(r.id, r))
    snapshot.joinedTeams.forEach((t) => joinedTeams.add(t))
    snapshot.registeredTournaments.forEach((t) => registeredTournaments.add(t))
    return true
  } catch {
    // Snapshot rusak — mulai bersih, jangan bikin app gagal boot.
    remove(SNAPSHOT_KEY)
    return false
  }
}

seed()
// Tes selalu mulai dari seed; hanya app di peramban yang memulihkan snapshot.
if (import.meta.env.MODE !== 'test') restoreDb()

/** Mengembalikan seluruh data contoh ke keadaan awal dan membuang snapshot. */
export function resetDb(): void {
  takenSlots.clear()
  bookings.clear()
  seed()
  remove(SNAPSHOT_KEY)
}
