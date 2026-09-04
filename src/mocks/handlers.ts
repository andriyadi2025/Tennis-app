import { http, HttpResponse, delay } from 'msw'
import type {
  AppNotification,
  Booking,
  ChatMessage,
  BookingPurpose,
  ClubSettings,
  Complaint,
  ComplaintDraft,
  ComplaintStatus,
  Court,
  CourtDraft,
  MerchItem,
  MerchItemDraft,
  MerchOrder,
  MerchOrderStatus,
  MerchPayMode,
  PaymentMethod,
  Role,
  Review,
  ReviewSummary,
  Slot,
  Sport,
  SparringInvite,
  TournamentRegistration,
  Venue,
} from '@/types'
import { MERCH_STATUS_LABEL } from '@/types'
import { computePrice } from '@/lib/pricing'
import { tierFor } from '@/lib/points'
import {
  deriveActivities,
  matchesPlayed,
  settleActivities,
  tallyActivities,
  totalActivityPoints,
} from '@/lib/activities'
import { decrementStock, findVariant, orderBlocker, quoteOrder, restoreStock } from '@/lib/merch'
import { sortByActivity, statusAfterReply, validateDraft, validateReply } from '@/lib/complaints'
import { toRange } from '@/lib/slots'
import { addWeeks, parseISO } from '@/lib/dates'
import {
  store,
  applySettingsToVenue,
  buildSlots,
  claimSlots,
  findCourt,
  findVenue,
  getBooking,
  awardedPoints,
  findComplaint,
  findMerchItem,
  getMerchOrder,
  listMerchOrders,
  replaceMerchItem,
  saveComplaint,
  saveMerchOrder,
  isCursedSlot,
  isSlotAvailable,
  markAwarded,
  listBookings,
  listRegistrations,
  membership,
  persistDb,
  saveRegistration,
  recomputeVenueRating,
  saveBooking,
} from './db'
import { STORAGE_KEYS, readJson } from '@/lib/storage'
import { CURRENT_USER } from './seed'

/** Tim yang dianggap milik user; pengirim tiap ajakan sparring keluar. */
const MY_TEAM = { id: 't-garuda', name: 'Garuda Muda FC' }

/**
 * Latensi buatan 300–800ms supaya skeleton benar-benar terlihat saat app
 * dijalankan. Di tes latensi dimatikan: yang diuji aturan bisnisnya, bukan
 * kesabaran menunggu.
 */
const SIMULATE_LATENCY = import.meta.env.MODE !== 'test'

async function latency(): Promise<void> {
  if (!SIMULATE_LATENCY) return
  await delay(300 + Math.floor(Math.random() * 500))
}

/** Hold pembayaran 10 menit. */
export const PAYMENT_HOLD_MS = 10 * 60 * 1_000

function bookingCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = 'DBTC-'
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}

function summarise(reviews: Review[]): ReviewSummary {
  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0]
  reviews.forEach((r) => {
    const idx = Math.min(4, Math.max(0, Math.round(r.rating) - 1))
    distribution[idx] = (distribution[idx] ?? 0) + 1
  })
  const total = reviews.length
  const average = total === 0 ? 0 : reviews.reduce((s, r) => s + r.rating, 0) / total
  return { average: Math.round(average * 10) / 10, total, distribution }
}

interface SearchFilters {
  q: string
  sport: Sport | null
  minPrice: number
  maxPrice: number
  maxDistance: number
  indoorOnly: boolean
}

function matches(venue: Venue, f: SearchFilters): boolean {
  if (f.sport && !venue.sport.includes(f.sport)) return false
  if (venue.pricePerHourIdr < f.minPrice || venue.pricePerHourIdr > f.maxPrice) return false
  if (venue.distanceKm > f.maxDistance) return false
  if (f.indoorOnly && !venue.indoor) return false
  if (f.q) {
    const haystack = [venue.name, venue.address, venue.district, ...venue.sport]
      .join(' ')
      .toLowerCase()
    if (!haystack.includes(f.q.toLowerCase())) return false
  }
  return true
}

interface CreateBookingBody {
  venueId: string
  courtId: string
  startsAt: string[]
  recurrenceWeeks: number
  addOnIds: string[]
  pointsRedeemed: number
  purpose?: BookingPurpose
}

interface PayBody {
  method: PaymentMethod
}

/**
 * Siapa yang sedang memanggil, menurut sesi auth yang sungguhan.
 *
 * Server tiruan ini dulu selalu membaca peran dari data seed, jadi pemanggil
 * mana pun dianggap admin — dan sisi anggota dari fitur aduan tidak pernah
 * benar-benar terpakai. Sesi auth adalah satu-satunya tempat yang tahu siapa
 * yang sebenarnya masuk, jadi ia yang dibaca. Kalau belum ada sesi (mis. di
 * tes yang menembak endpoint langsung), peran seed dipakai seperti dulu.
 */
function caller(): { id: string; name: string; role: Role } {
  const session = readJson<{ user: { id: string; name: string; role: Role } | null } | null>(
    STORAGE_KEYS.auth,
    null,
  )
  const user = session?.user
  if (!user) return { id: CURRENT_USER.id, name: store.profile.name, role: CURRENT_USER.role }
  return { id: user.id, name: user.name, role: user.role }
}

/** Gerbang peran. Endpoint admin menolak siapa pun yang bukan admin. */
function isAdmin(): boolean {
  return caller().role === 'admin'
}

function forbidden() {
  return HttpResponse.json(
    { code: 'FORBIDDEN', message: 'Hanya admin klub yang boleh mengubah pengaturan ini.' },
    { status: 403 },
  )
}

/**
 * Validasi pengaturan klub. Pesannya sengaja menjelaskan aturannya, bukan
 * sekadar bilang "tidak valid" — admin perlu tahu apa yang harus dibetulkan.
 */
export function validateSettings(s: ClubSettings): string | null {
  if (!s.name.trim()) return 'Nama klub tidak boleh kosong.'
  if (!s.address.trim()) return 'Alamat klub tidak boleh kosong.'
  const { open, close } = s.openHours
  if (!Number.isInteger(open) || !Number.isInteger(close)) return 'Jam buka harus bilangan bulat.'
  if (open < 0 || open > 23) return 'Jam buka harus antara 0 dan 23.'
  if (close < 1 || close > 24) return 'Jam tutup harus antara 1 dan 24.'
  if (close <= open) return 'Jam tutup harus lebih malam dari jam buka.'
  if (s.basePricePerHourIdr < 1_000) return 'Tarif dasar minimal Rp1.000 per jam.'
  if (s.serviceFeeIdr < 0) return 'Biaya layanan tidak boleh negatif.'

  const { from, to, multiplier } = s.primeTime
  if (from < 0 || from > 23 || to < 0 || to > 23) return 'Jam prime time harus antara 0 dan 23.'
  if (multiplier < 1 || multiplier > 3) return 'Pengali prime time harus antara 1 dan 3.'

  for (const [kind, value] of Object.entries(s.activityPoints)) {
    if (!Number.isInteger(value) || value < 0 || value > 1_000) {
      return `Poin untuk "${kind}" harus bilangan bulat 0–1.000.`
    }
  }

  const { duesMonthlyIdr, memberDiscount } = s.membership
  if (duesMonthlyIdr < 0) return 'Iuran tidak boleh negatif.'
  if (memberDiscount < 0 || memberDiscount > 0.9) {
    return 'Potongan anggota harus antara 0% dan 90%.'
  }
  return null
}

/** Nama lapangan dipakai user untuk membedakannya, jadi harus unik. */
export function validateCourt(draft: CourtDraft, siblings: readonly Court[]): string | null {
  const name = draft.name.trim()
  if (!name) return 'Nama lapangan tidak boleh kosong.'
  if (siblings.some((c) => c.name.trim().toLowerCase() === name.toLowerCase())) {
    return `Sudah ada lapangan bernama "${name}".`
  }
  if (!draft.surface.trim()) return 'Jenis permukaan tidak boleh kosong.'
  if (draft.pricePerHourIdr !== null && draft.pricePerHourIdr < 1_000) {
    return 'Tarif lapangan minimal Rp1.000 per jam.'
  }
  return null
}

/* ── Toko & aduan: penolong ────────────────────────────────────────────── */

interface MerchOrderBody {
  variantId: string
  qty: number
  payMode: MerchPayMode
  paymentMethod?: PaymentMethod
}

/** Urutan status pesanan yang sah; juga dipakai memvalidasi kiriman admin. */
export const MERCH_FLOW: readonly MerchOrderStatus[] = [
  'menunggu',
  'disiapkan',
  'siapDiambil',
  'selesai',
  'batal',
]

export const COMPLAINT_FLOW: readonly ComplaintStatus[] = ['baru', 'diproses', 'selesai']

function shortCode(prefix: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = `${prefix}-`
  for (let i = 0; i < 4; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}

const merchCode = () => shortCode('TKO')
const complaintCode = () => shortCode('ADU')

/**
 * Mengembalikan stok dan poin sebuah pesanan yang dibatalkan.
 *
 * Poin belanja yang sempat didapat ikut ditarik: kalau tidak, membeli lalu
 * membatalkan jadi cara mencetak poin tanpa membayar apa pun.
 */
function refundMerchOrder(order: MerchOrder): void {
  const item = findMerchItem(order.itemId)
  if (item) replaceMerchItem(restoreStock(item, order.variantId, order.qty))
  store.profile.points = Math.max(0, store.profile.points + order.pointsSpent - order.pointsEarned)
  store.profile.tier = tierFor(store.profile.points)
}

/**
 * Validasi barang toko. Sebuah barang harus punya setidaknya satu cara dibeli
 * — tanpa harga rupiah maupun harga poin, ia cuma pajangan yang membingungkan.
 */
export function validateMerchDraft(draft: MerchItemDraft): string | null {
  if (!draft.name.trim()) return 'Nama barang tidak boleh kosong.'
  if (draft.priceIdr === null && draft.pricePoints === null) {
    return 'Isi harga rupiah, harga poin, atau keduanya.'
  }
  if (draft.priceIdr !== null && draft.priceIdr < 1_000) {
    return 'Harga rupiah minimal Rp1.000.'
  }
  if (draft.pricePoints !== null && draft.pricePoints < 1) {
    return 'Harga poin minimal 1 poin.'
  }
  if (draft.variants.length === 0) return 'Tambahkan minimal satu varian atau ukuran.'
  const labels = draft.variants.map((v) => v.label.trim().toLowerCase())
  if (labels.some((l) => !l)) return 'Nama varian tidak boleh kosong.'
  if (new Set(labels).size !== labels.length) return 'Nama varian tidak boleh kembar.'
  if (draft.variants.some((v) => !Number.isInteger(v.stock) || v.stock < 0)) {
    return 'Stok harus bilangan bulat 0 atau lebih.'
  }
  return null
}

/** Barang baru mendapat blok warna yang stabil, diturunkan dari idnya. */
function itemFromDraft(draft: MerchItemDraft, id: string): MerchItem {
  const tones = ['accent', 'accent2', 'neutral'] as const
  const seed = id.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
  return {
    id,
    name: draft.name.trim(),
    category: draft.category,
    description: draft.description.trim(),
    photo: { tone: tones[seed % 3] ?? 'accent', step: 300, seed },
    priceIdr: draft.priceIdr,
    pricePoints: draft.pricePoints,
    variants: draft.variants.map((v, i) => ({
      id: `${id}-v${i}`,
      label: v.label.trim(),
      stock: v.stock,
    })),
    membersOnly: draft.membersOnly,
    active: draft.active,
  }
}

/**
 * Nama yang enak dibaca untuk booking atau pesanan yang diadukan. Kalau
 * rujukannya sudah tidak ada, aduan tetap dibuat tanpa label — kehilangan
 * konteks lebih baik daripada kehilangan aduannya.
 */
function labelForRelated(kind: Complaint['relatedKind'], id: string | null): string | null {
  if (!kind || !id) return null
  if (kind === 'booking') {
    const booking = getBooking(id)
    return booking ? `${booking.venueName} · ${booking.code}` : null
  }
  const order = getMerchOrder(id)
  return order ? `${order.itemName} · ${order.code}` : null
}

export const ADD_ONS = [
  { id: 'a-shuttlecock', label: 'Shuttlecock (1 tube)', priceIdr: 95_000 },
  { id: 'a-raket', label: 'Sewa raket', priceIdr: 25_000 },
  { id: 'a-bola', label: 'Sewa bola', priceIdr: 20_000 },
  { id: 'a-rompi', label: 'Rompi tim (10 pcs)', priceIdr: 30_000 },
  { id: 'a-air', label: 'Air mineral 1 dus', priceIdr: 35_000 },
] as const

export const handlers = [
  http.get('/api/me', async () => {
    await latency()
    return HttpResponse.json(store.profile)
  }),

  /**
   * Catatan aktivitas. Diturunkan tiap kali dibaca, lalu poin partisipasi
   * dikreditkan sekali saja untuk kegiatan yang baru pertama muncul.
   * Idempoten: membuka profil sepuluh kali tidak memberi poin sepuluh kali.
   */
  http.get('/api/activities', async () => {
    await latency()
    const activities = deriveActivities({
      bookings: listBookings(),
      openMatches: store.openMatches,
      tournaments: store.tournaments,
      registrations: listRegistrations(),
      sparring: store.sparring,
      userId: CURRENT_USER.id,
      points: store.settings.activityPoints,
    })

    const { activities: settled, credited } = settleActivities(
      activities,
      awardedPoints,
      markAwarded,
    )

    if (credited > 0) {
      store.profile.points += credited
      store.profile.tier = tierFor(store.profile.points)
      persistDb()
    }

    const tally = tallyActivities(settled)
    return HttpResponse.json({
      activities: settled,
      tally,
      matchesPlayed: matchesPlayed(tally),
      pointsFromActivities: totalActivityPoints(settled),
    })
  }),

  /** Poin bertambah setelah main dan berkurang saat ditukar. */
  http.post('/api/me/points', async ({ request }) => {
    await latency()
    const { delta } = (await request.json()) as { delta: number }
    store.profile.points = Math.max(0, store.profile.points + Math.round(delta))
    store.profile.tier = tierFor(store.profile.points)
    persistDb()
    return HttpResponse.json(store.profile)
  }),

  http.get('/api/venues', async ({ request }) => {
    await latency()
    const url = new URL(request.url)
    const filters: SearchFilters = {
      q: url.searchParams.get('q') ?? '',
      sport: (url.searchParams.get('sport') as Sport | null) || null,
      minPrice: Number(url.searchParams.get('minPrice') ?? 0),
      maxPrice: Number(url.searchParams.get('maxPrice') ?? Number.MAX_SAFE_INTEGER),
      maxDistance: Number(url.searchParams.get('maxDistance') ?? 999),
      indoorOnly: url.searchParams.get('indoor') === '1',
    }
    // Query "gagal" khusus untuk memancing state error di UI.
    if (filters.q.trim().toLowerCase() === 'error') {
      return HttpResponse.json({ message: 'Server sedang sibuk. Coba lagi.' }, { status: 500 })
    }
    const results = store.venues
      .filter((v) => matches(v, filters))
      .sort((a, b) => a.distanceKm - b.distanceKm)
    return HttpResponse.json(results)
  }),

  http.get('/api/venues/:id', async ({ params }) => {
    await latency()
    const venue = findVenue(String(params.id))
    if (!venue) return HttpResponse.json({ message: 'Venue tidak ditemukan.' }, { status: 404 })
    return HttpResponse.json(venue)
  }),

  http.get('/api/venues/:id/reviews', async ({ params }) => {
    await latency()
    const venueId = String(params.id)
    const reviews = store.reviews
      .filter((r) => r.venueId === venueId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return HttpResponse.json({ reviews, summary: summarise(reviews) })
  }),

  /** Grid slot satu lapangan pada satu hari. */
  http.get('/api/venues/:id/slots', async ({ params, request }) => {
    await latency()
    const venue = findVenue(String(params.id))
    if (!venue) return HttpResponse.json({ message: 'Venue tidak ditemukan.' }, { status: 404 })
    const url = new URL(request.url)
    const courtId = url.searchParams.get('courtId') ?? venue.courts[0]?.id ?? ''
    const date = url.searchParams.get('date')
    const court = findCourt(venue, courtId)
    if (!court || !date) {
      return HttpResponse.json({ message: 'Lapangan atau tanggal tidak valid.' }, { status: 400 })
    }
    const slots: Slot[] = buildSlots(venue, court, date)
    return HttpResponse.json(slots)
  }),

  /**
   * Cek ketersediaan sekumpulan slot di masa depan — dipakai toggle
   * "ulangi tiap Jumat" sebelum booking dikunci.
   */
  http.post('/api/availability/check', async ({ request }) => {
    await latency()
    const body = (await request.json()) as {
      courtId: string
      startsAt: string[]
      weeks: number
    }
    const conflicts: { weekOffset: number; startsAt: string[] }[] = []
    for (let week = 1; week < Math.max(1, Math.floor(body.weeks)); week += 1) {
      const clashes = body.startsAt
        .map((iso) => addWeeks(parseISO(iso), week).toISOString())
        .filter((iso) => !isSlotAvailable(body.courtId, iso))
      if (clashes.length > 0) conflicts.push({ weekOffset: week, startsAt: clashes })
    }
    return HttpResponse.json({ conflicts })
  }),

  http.get('/api/addons', async () => {
    await latency()
    return HttpResponse.json(ADD_ONS)
  }),

  /** draft → summary: server menghitung ulang harga, klien tidak dipercaya. */
  http.post('/api/bookings', async ({ request }) => {
    await latency()
    const body = (await request.json()) as CreateBookingBody
    const venue = findVenue(body.venueId)
    const court = venue ? findCourt(venue, body.courtId) : undefined
    if (!venue || !court) {
      return HttpResponse.json({ message: 'Venue atau lapangan tidak ditemukan.' }, { status: 404 })
    }
    const range = toRange(body.startsAt)
    if (!range) {
      return HttpResponse.json({ message: 'Belum ada jam yang dipilih.' }, { status: 400 })
    }

    const unavailable = body.startsAt.filter((iso) => !isSlotAvailable(court.id, iso))
    if (unavailable.length > 0) {
      return HttpResponse.json(
        { code: 'SLOT_TAKEN', message: 'Slot keburu diambil orang lain.', startsAt: unavailable },
        { status: 409 },
      )
    }

    const slots = buildSlots(venue, court, range.startsAt).filter((s) =>
      body.startsAt.includes(s.startsAt),
    )
    const addOns = ADD_ONS.filter((a) => body.addOnIds.includes(a.id)).map((a) => ({
      ...a,
      qty: 1,
    }))
    const weeks = Math.max(1, Math.floor(body.recurrenceWeeks))
    const price = computePrice({ slots, addOns, weeks })
    const discountIdr = (body.pointsRedeemed / 100) * 10_000
    const final = computePrice({ slots, addOns, weeks, discountIdr })

    const booking: Booking = {
      id: `bk-${Date.now().toString(36)}`,
      venueId: venue.id,
      venueName: venue.name,
      courtId: court.id,
      courtName: court.name,
      sport: court.sport,
      range,
      recurrence: weeks > 1 ? { weekly: true, weeks } : null,
      purpose: body.purpose === 'berlatih' ? 'berlatih' : 'bermain',
      addOns,
      splitBill: null,
      status: 'awaitingPayment',
      paymentMethod: null,
      code: bookingCode(),
      subtotalIdr: price.subtotalIdr,
      pointsRedeemed: body.pointsRedeemed,
      discountIdr: final.discountIdr,
      serviceFeeIdr: final.serviceFeeIdr,
      totalIdr: final.totalIdr,
      createdAt: new Date().toISOString(),
      paymentDeadline: new Date(Date.now() + PAYMENT_HOLD_MS).toISOString(),
    }
    saveBooking(booking)
    persistDb()
    return HttpResponse.json(booking, { status: 201 })
  }),

  http.get('/api/bookings', async () => {
    await latency()
    return HttpResponse.json(listBookings())
  }),

  http.get('/api/bookings/:id', async ({ params }) => {
    await latency()
    const booking = getBooking(String(params.id))
    if (!booking) return HttpResponse.json({ message: 'Booking tidak ditemukan.' }, { status: 404 })
    return HttpResponse.json(booking)
  }),

  /** awaitingPayment → confirmed. Menolak hold yang sudah lewat. */
  http.post('/api/bookings/:id/pay', async ({ params, request }) => {
    await latency()
    const booking = getBooking(String(params.id))
    if (!booking) return HttpResponse.json({ message: 'Booking tidak ditemukan.' }, { status: 404 })

    if (booking.status === 'confirmed') {
      return HttpResponse.json({ booking, payment: null })
    }
    if (booking.status !== 'awaitingPayment') {
      return HttpResponse.json(
        { code: 'STALE_DRAFT', message: 'Booking ini sudah tidak bisa dibayar.' },
        { status: 409 },
      )
    }
    if (booking.paymentDeadline && new Date(booking.paymentDeadline).getTime() < Date.now()) {
      const expired = { ...booking, status: 'expired' as const }
      saveBooking(expired)
      return HttpResponse.json(
        { code: 'PAYMENT_EXPIRED', message: 'Waktu pembayaran habis. Slot dilepas kembali.' },
        { status: 410 },
      )
    }

    const hours = Array.from({ length: booking.range.hours }, (_, i) =>
      new Date(new Date(booking.range.startsAt).getTime() + i * 3_600_000).toISOString(),
    )

    // Kasus error yang sengaja dipasang: slot direbut tepat saat bayar.
    if (isCursedSlot(booking.courtId, hours)) {
      return HttpResponse.json(
        {
          code: 'SLOT_TAKEN',
          message: 'Yah, slot ini baru saja diambil orang lain. Pilih jam lain ya.',
          startsAt: hours,
        },
        { status: 409 },
      )
    }

    const body = (await request.json()) as PayBody
    claimSlots(booking.courtId, hours)
    if (booking.recurrence) {
      for (let w = 1; w < booking.recurrence.weeks; w += 1) {
        claimSlots(
          booking.courtId,
          hours.map((iso) => addWeeks(parseISO(iso), w).toISOString()),
        )
      }
    }
    /*
     * Bentuknya mengikuti server sungguhan: menekan Bayar membuat tagihan,
     * bukan mengonfirmasi booking. Kalau tiruan ini mengembalikan bentuk lama,
     * tes komponen akan lulus atas kontrak yang sudah tidak ada.
     */
    const payment = {
      id: `pay-${Date.now().toString(36)}`,
      kind: 'booking' as const,
      refId: booking.id,
      amountIdr: booking.totalIdr,
      method: body.method,
      status: 'pending' as const,
      provider: 'simulator',
      redirectUrl: null,
      qrString: `SIMULASI-DBTC|${booking.id}|${booking.totalIdr}`,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      settledAt: null,
      createdAt: new Date().toISOString(),
    }
    saveBooking({ ...booking, paymentMethod: body.method })
    persistDb()
    return HttpResponse.json({ booking, payment }, { status: 201 })
  }),

  http.get('/api/payments/:id', async ({ params }) => {
    await latency()
    return HttpResponse.json({
      id: String(params.id),
      kind: 'booking',
      refId: 'bk-seed-1',
      amountIdr: 0,
      method: 'qris',
      status: 'pending',
      provider: 'simulator',
      redirectUrl: null,
      qrString: 'SIMULASI-DBTC',
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      settledAt: null,
      createdAt: new Date().toISOString(),
    })
  }),

  http.post('/api/bookings/:id/split', async ({ params, request }) => {
    await latency()
    const booking = getBooking(String(params.id))
    if (!booking) return HttpResponse.json({ message: 'Booking tidak ditemukan.' }, { status: 404 })
    const body = (await request.json()) as { splitBill: Booking['splitBill'] }
    const next = { ...booking, splitBill: body.splitBill }
    saveBooking(next)
    persistDb()
    return HttpResponse.json(next)
  }),

  http.get('/api/open-matches', async ({ request }) => {
    await latency()
    const url = new URL(request.url)
    const sport = url.searchParams.get('sport') as Sport | null
    const list = sport ? store.openMatches.filter((m) => m.sport === sport) : store.openMatches
    return HttpResponse.json(
      [...list].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    )
  }),

  http.get('/api/open-matches/:id', async ({ params }) => {
    await latency()
    const match = store.openMatches.find((m) => m.id === String(params.id))
    if (!match)
      return HttpResponse.json({ message: 'Open match tidak ditemukan.' }, { status: 404 })
    return HttpResponse.json(match)
  }),

  http.get('/api/tournaments', async () => {
    await latency()
    return HttpResponse.json(store.tournaments)
  }),

  http.get('/api/teams', async () => {
    await latency()
    return HttpResponse.json(store.teams)
  }),

  http.get('/api/teams/:id', async ({ params }) => {
    await latency()
    const team = store.teams.find((t) => t.id === String(params.id))
    if (!team) return HttpResponse.json({ message: 'Tim tidak ditemukan.' }, { status: 404 })
    return HttpResponse.json(team)
  }),

  http.get('/api/notifications', async () => {
    await latency()
    const list: AppNotification[] = [...store.notifications].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    return HttpResponse.json(list)
  }),

  http.get('/api/chats/:id', async ({ params }) => {
    await latency()
    const chat = store.chats.find((c) => c.id === String(params.id))
    if (!chat) return HttpResponse.json({ message: 'Obrolan tidak ditemukan.' }, { status: 404 })
    return HttpResponse.json(chat)
  }),

  http.post('/api/chats/:id/messages', async ({ params, request }) => {
    await latency()
    const chat = store.chats.find((c) => c.id === String(params.id))
    if (!chat) return HttpResponse.json({ message: 'Obrolan tidak ditemukan.' }, { status: 404 })
    const body = (await request.json()) as { body: string }
    const message: ChatMessage = {
      id: `m-${Date.now().toString(36)}`,
      chatId: chat.id,
      authorId: CURRENT_USER.id,
      authorName: CURRENT_USER.name.split(' ')[0] ?? CURRENT_USER.name,
      body: body.body,
      sentAt: new Date().toISOString(),
    }
    chat.messages.push(message)
    persistDb()
    return HttpResponse.json(message, { status: 201 })
  }),

  /* ── Aksi komunitas ──────────────────────────────────────────────────── */

  /** Gabung open match. Menolak kalau slot sudah habis atau sudah gabung. */
  http.post('/api/open-matches/:id/join', async ({ params }) => {
    await latency()
    const match = store.openMatches.find((m) => m.id === String(params.id))
    if (!match)
      return HttpResponse.json({ message: 'Open match tidak ditemukan.' }, { status: 404 })

    if (match.players.some((p) => p.id === CURRENT_USER.id)) {
      return HttpResponse.json(
        { code: 'ALREADY_JOINED', message: 'Kamu sudah gabung di sesi ini.' },
        { status: 409 },
      )
    }
    if (match.players.length >= match.slotsTotal) {
      return HttpResponse.json(
        { code: 'MATCH_FULL', message: 'Yah, slotnya baru saja penuh.' },
        { status: 409 },
      )
    }

    match.players.push({
      id: CURRENT_USER.id,
      name: CURRENT_USER.name.split(' ')[0] ?? CURRENT_USER.name,
      level: 'menengah',
    })
    persistDb()
    return HttpResponse.json(match)
  }),

  http.post('/api/open-matches/:id/leave', async ({ params }) => {
    await latency()
    const match = store.openMatches.find((m) => m.id === String(params.id))
    if (!match)
      return HttpResponse.json({ message: 'Open match tidak ditemukan.' }, { status: 404 })
    match.players = match.players.filter((p) => p.id !== CURRENT_USER.id)
    persistDb()
    return HttpResponse.json(match)
  }),

  http.post('/api/notifications/:id/read', async ({ params }) => {
    await latency()
    const item = store.notifications.find((n) => n.id === String(params.id))
    if (!item) return HttpResponse.json({ message: 'Notifikasi tidak ditemukan.' }, { status: 404 })
    item.read = true
    persistDb()
    return HttpResponse.json(item)
  }),

  http.post('/api/notifications/read-all', async () => {
    await latency()
    store.notifications.forEach((n) => {
      n.read = true
    })
    persistDb()
    return HttpResponse.json(store.notifications)
  }),

  /** Tulis ulasan. Rating venue ikut dihitung ulang agar tidak kontradiktif. */
  http.post('/api/venues/:id/reviews', async ({ params, request }) => {
    await latency()
    const venueId = String(params.id)
    if (!findVenue(venueId)) {
      return HttpResponse.json({ message: 'Venue tidak ditemukan.' }, { status: 404 })
    }
    const body = (await request.json()) as { rating: number; body: string }
    const rating = Math.round(body.rating)
    if (rating < 1 || rating > 5) {
      return HttpResponse.json({ message: 'Rating harus 1–5 bintang.' }, { status: 422 })
    }
    if (body.body.trim().length < 10) {
      return HttpResponse.json(
        { message: 'Ceritakan sedikit lebih panjang, minimal 10 karakter.' },
        { status: 422 },
      )
    }

    const review: Review = {
      id: `r-${Date.now().toString(36)}`,
      venueId,
      authorName: CURRENT_USER.name,
      rating,
      createdAt: new Date().toISOString(),
      body: body.body.trim(),
      tags: [],
    }
    store.reviews.unshift(review)
    recomputeVenueRating(venueId)
    persistDb()
    return HttpResponse.json(review, { status: 201 })
  }),

  http.post('/api/teams/:id/join', async ({ params }) => {
    await latency()
    const team = store.teams.find((t) => t.id === String(params.id))
    if (!team) return HttpResponse.json({ message: 'Tim tidak ditemukan.' }, { status: 404 })
    if (membership.hasJoinedTeam(team.id)) {
      return HttpResponse.json(
        { code: 'ALREADY_JOINED', message: 'Kamu sudah jadi anggota tim ini.' },
        { status: 409 },
      )
    }
    membership.joinTeam(team.id)
    team.memberCount += 1
    team.members.push({
      id: CURRENT_USER.id,
      name: CURRENT_USER.name.split(' ')[0] ?? CURRENT_USER.name,
      level: 'menengah',
    })
    persistDb()
    return HttpResponse.json(team)
  }),

  /** Ajakan sparring keluar — masuk ke kotak ajakan sebagai `keluar`. */
  http.post('/api/teams/:id/spar', async ({ params, request }) => {
    await latency()
    const team = store.teams.find((t) => t.id === String(params.id))
    if (!team) return HttpResponse.json({ message: 'Tim tidak ditemukan.' }, { status: 404 })

    const pending = store.sparring.find(
      (s) => s.direction === 'keluar' && s.toTeamId === team.id && s.status === 'menunggu',
    )
    if (pending) {
      return HttpResponse.json(
        { code: 'ALREADY_SENT', message: `Ajakan ke ${team.name} masih menunggu jawaban.` },
        { status: 409 },
      )
    }

    const body = (await request.json().catch(() => ({}))) as { message?: string }
    const invite: SparringInvite = {
      id: `sp-${Date.now().toString(36)}`,
      direction: 'keluar',
      fromTeamId: MY_TEAM.id,
      fromTeamName: MY_TEAM.name,
      toTeamId: team.id,
      toTeamName: team.name,
      sport: team.sport,
      proposedAt: null,
      venueName: null,
      message: body.message?.trim() || 'Ada slot buat sparring minggu ini?',
      status: 'menunggu',
      createdAt: new Date().toISOString(),
    }
    store.sparring.unshift(invite)

    store.notifications.unshift({
      id: `n-${Date.now().toString(36)}`,
      kind: 'match',
      title: `Ajakan sparring terkirim ke ${team.name}`,
      body: 'Kami kabari begitu mereka membalas.',
      createdAt: new Date().toISOString(),
      read: false,
      href: '/sparring',
    })
    persistDb()
    return HttpResponse.json(invite, { status: 201 })
  }),

  /**
   * Daftar turnamen. Kuota hanya bergerak setelah biaya daftar dibayar —
   * mendaftar dan membayar bukan dua hal terpisah di sini.
   */
  http.post('/api/tournaments/:id/register', async ({ params, request }) => {
    await latency()
    const tournament = store.tournaments.find((t) => t.id === String(params.id))
    if (!tournament) {
      return HttpResponse.json({ message: 'Turnamen tidak ditemukan.' }, { status: 404 })
    }
    if (membership.hasRegistered(tournament.id)) {
      return HttpResponse.json(
        { code: 'ALREADY_REGISTERED', message: 'Kamu sudah terdaftar di turnamen ini.' },
        { status: 409 },
      )
    }
    if (tournament.status !== 'pendaftaran') {
      return HttpResponse.json(
        { code: 'CLOSED', message: 'Pendaftaran turnamen ini sudah ditutup.' },
        { status: 409 },
      )
    }
    if (tournament.slotsTaken >= tournament.slotsTotal) {
      return HttpResponse.json(
        { code: 'FULL', message: 'Kuota peserta sudah penuh.' },
        { status: 409 },
      )
    }

    const body = (await request.json()) as { method?: PaymentMethod }
    const method = body.method
    if (!method) {
      return HttpResponse.json(
        { code: 'NO_METHOD', message: 'Pilih metode pembayaran dulu.' },
        { status: 422 },
      )
    }

    membership.register(tournament.id)
    tournament.slotsTaken += 1

    const registration: TournamentRegistration = {
      id: `trg-${Date.now().toString(36)}`,
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      entryFeeIdr: tournament.entryFeeIdr,
      paymentMethod: method,
      // Bayar di tempat berarti belum lunas, dan itu harus terlihat jujur.
      paymentStatus: method === 'onsite' ? 'menunggu' : 'lunas',
      registeredAt: new Date().toISOString(),
      code: bookingCode().replace('DBTC-', 'TRN-'),
    }
    saveRegistration(registration)
    persistDb()
    return HttpResponse.json({ tournament, registration })
  }),

  http.get('/api/tournaments/registrations', async () => {
    await latency()
    return HttpResponse.json(listRegistrations())
  }),

  /* ── Ajakan sparring ─────────────────────────────────────────────────── */

  http.get('/api/sparring', async () => {
    await latency()
    const list = [...store.sparring].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    return HttpResponse.json(list)
  }),

  http.post('/api/sparring/:id/respond', async ({ params, request }) => {
    await latency()
    const invite = store.sparring.find((s) => s.id === String(params.id))
    if (!invite) return HttpResponse.json({ message: 'Ajakan tidak ditemukan.' }, { status: 404 })

    if (invite.direction !== 'masuk') {
      return HttpResponse.json(
        { code: 'NOT_YOURS', message: 'Ajakan ini menunggu jawaban tim lain, bukan kamu.' },
        { status: 409 },
      )
    }
    if (invite.status !== 'menunggu') {
      return HttpResponse.json(
        { code: 'ALREADY_ANSWERED', message: 'Ajakan ini sudah dijawab.' },
        { status: 409 },
      )
    }

    const body = (await request.json()) as { accept: boolean }
    invite.status = body.accept ? 'diterima' : 'ditolak'

    store.notifications.unshift({
      id: `n-${Date.now().toString(36)}`,
      kind: 'match',
      title: body.accept
        ? `Sparring dengan ${invite.fromTeamName} disetujui`
        : `Ajakan ${invite.fromTeamName} ditolak`,
      body: body.accept
        ? 'Kami kabari mereka. Atur jadwal lapangannya dari halaman tim.'
        : 'Mereka sudah diberi tahu.',
      createdAt: new Date().toISOString(),
      read: false,
      href: '/sparring',
    })
    persistDb()
    return HttpResponse.json(invite)
  }),

  /* ── Dasbor admin klub ───────────────────────────────────────────────── */

  http.get('/api/admin/settings', async () => {
    await latency()
    return HttpResponse.json(store.settings)
  }),

  /**
   * Menyimpan pengaturan klub. Divalidasi di server, bukan cuma di form:
   * form bisa dilewati, endpoint tidak.
   */
  http.patch('/api/admin/settings', async ({ request }) => {
    await latency()
    if (!isAdmin()) return forbidden()

    const patch = (await request.json()) as Partial<ClubSettings>
    const next: ClubSettings = {
      ...store.settings,
      ...patch,
      openHours: { ...store.settings.openHours, ...(patch.openHours ?? {}) },
      primeTime: { ...store.settings.primeTime, ...(patch.primeTime ?? {}) },
      membership: { ...store.settings.membership, ...(patch.membership ?? {}) },
      activityPoints: { ...store.settings.activityPoints, ...(patch.activityPoints ?? {}) },
    }

    const problem = validateSettings(next)
    if (problem) return HttpResponse.json({ message: problem }, { status: 422 })

    store.settings = next
    applySettingsToVenue()
    persistDb()
    return HttpResponse.json(store.settings)
  }),

  http.get('/api/admin/courts', async () => {
    await latency()
    const venue = findVenue(store.settings.venueId)
    return HttpResponse.json(venue?.courts ?? [])
  }),

  http.post('/api/admin/courts', async ({ request }) => {
    await latency()
    if (!isAdmin()) return forbidden()
    const venue = findVenue(store.settings.venueId)
    if (!venue) return HttpResponse.json({ message: 'Venue klub tidak ada.' }, { status: 404 })

    const draft = (await request.json()) as CourtDraft
    const problem = validateCourt(draft, venue.courts)
    if (problem) return HttpResponse.json({ message: problem }, { status: 422 })

    venue.courts.push({
      id: `${venue.id}-c${Date.now().toString(36)}`,
      venueId: venue.id,
      name: draft.name.trim(),
      sport: draft.sport,
      indoor: draft.indoor,
      surface: draft.surface.trim(),
      ...(draft.pricePerHourIdr ? { pricePerHourIdr: draft.pricePerHourIdr } : {}),
    })
    applySettingsToVenue()
    persistDb()
    return HttpResponse.json(venue.courts, { status: 201 })
  }),

  http.patch('/api/admin/courts/:id', async ({ params, request }) => {
    await latency()
    if (!isAdmin()) return forbidden()
    const venue = findVenue(store.settings.venueId)
    const court = venue?.courts.find((c) => c.id === String(params.id))
    if (!venue || !court) {
      return HttpResponse.json({ message: 'Lapangan tidak ditemukan.' }, { status: 404 })
    }

    const draft = (await request.json()) as CourtDraft
    const problem = validateCourt(
      draft,
      venue.courts.filter((c) => c.id !== court.id),
    )
    if (problem) return HttpResponse.json({ message: problem }, { status: 422 })

    court.name = draft.name.trim()
    court.sport = draft.sport
    court.indoor = draft.indoor
    court.surface = draft.surface.trim()
    if (draft.pricePerHourIdr) court.pricePerHourIdr = draft.pricePerHourIdr
    else delete court.pricePerHourIdr

    applySettingsToVenue()
    persistDb()
    return HttpResponse.json(venue.courts)
  }),

  http.delete('/api/admin/courts/:id', async ({ params }) => {
    await latency()
    if (!isAdmin()) return forbidden()
    const venue = findVenue(store.settings.venueId)
    if (!venue) return HttpResponse.json({ message: 'Venue klub tidak ada.' }, { status: 404 })

    const id = String(params.id)
    if (venue.courts.length <= 1) {
      return HttpResponse.json(
        { code: 'LAST_COURT', message: 'Klub harus punya minimal satu lapangan.' },
        { status: 409 },
      )
    }
    // Lapangan yang masih punya booking mendatang tidak boleh hilang begitu saja.
    const upcoming = listBookings().filter(
      (b) => b.courtId === id && new Date(b.range.endsAt).getTime() > Date.now(),
    )
    if (upcoming.length > 0) {
      return HttpResponse.json(
        {
          code: 'HAS_BOOKINGS',
          message: `Masih ada ${upcoming.length} booking mendatang di lapangan ini.`,
        },
        { status: 409 },
      )
    }

    venue.courts = venue.courts.filter((c) => c.id !== id)
    applySettingsToVenue()
    persistDb()
    return HttpResponse.json(venue.courts)
  }),

  /* ── Toko merchandise ──────────────────────────────────────────────────
   * Katalog, pemesanan, dan riwayat. Aturannya dipanggil dari `lib/merch`,
   * bukan ditulis ulang di sini: penjaga yang ditulis dua kali akan menyimpang
   * dari yang dipakai layar, dan yang menyimpang biasanya yang di server.
   * ──────────────────────────────────────────────────────────────────── */

  http.get('/api/merch', async ({ request }) => {
    await latency()
    const category = new URL(request.url).searchParams.get('category')
    const rows = store.merch
      .filter((m) => m.active)
      .filter((m) => (category ? m.category === category : true))
    return HttpResponse.json(rows)
  }),

  http.get('/api/merch/:id', async ({ params }) => {
    await latency()
    const item = findMerchItem(String(params.id))
    // Barang nonaktif tetap bisa dibuka lewat tautan dari riwayat pesanan.
    if (!item) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Barang tidak ditemukan.' },
        { status: 404 },
      )
    }
    return HttpResponse.json(item)
  }),

  /**
   * Memesan. Stok dipotong dan poin dipindahkan sekaligus — pemeriksaannya
   * dilakukan lebih dulu, jadi tidak ada keadaan setengah jadi kalau ditolak.
   */
  http.post('/api/merch/:id/order', async ({ params, request }) => {
    await latency()
    const item = findMerchItem(String(params.id))
    if (!item) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Barang tidak ditemukan.' },
        { status: 404 },
      )
    }

    const body = (await request.json()) as MerchOrderBody
    const blocker = orderBlocker({
      item,
      variantId: body.variantId,
      qty: body.qty,
      payMode: body.payMode,
      user: store.profile,
    })
    if (blocker) {
      // 409, bukan 400: yang salah bukan bentuk permintaannya melainkan
      // keadaan saat ini — stok habis, poin kurang, bukan anggota.
      return HttpResponse.json({ code: 'ORDER_BLOCKED', message: blocker }, { status: 409 })
    }

    const variant = findVariant(item, body.variantId)
    if (!variant) {
      return HttpResponse.json(
        { code: 'ORDER_BLOCKED', message: 'Varian tidak ditemukan.' },
        { status: 409 },
      )
    }
    const quote = quoteOrder(item, body.qty, body.payMode)

    const order: MerchOrder = {
      id: `mo-${Date.now().toString(36)}`,
      code: merchCode(),
      itemId: item.id,
      itemName: item.name,
      variantId: variant.id,
      variantLabel: variant.label,
      qty: quote.qty,
      payMode: quote.payMode,
      paymentMethod: quote.payMode === 'uang' ? (body.paymentMethod ?? 'qris') : null,
      totalIdr: quote.totalIdr,
      pointsSpent: quote.pointsSpent,
      pointsEarned: quote.pointsEarned,
      status: 'menunggu',
      createdAt: new Date().toISOString(),
    }

    replaceMerchItem(decrementStock(item, variant.id, quote.qty))
    saveMerchOrder(order)

    store.profile.points = Math.max(
      0,
      store.profile.points - quote.pointsSpent + quote.pointsEarned,
    )
    store.profile.tier = tierFor(store.profile.points)
    persistDb()

    return HttpResponse.json(order, { status: 201 })
  }),

  http.get('/api/merch-orders', async () => {
    await latency()
    return HttpResponse.json(listMerchOrders())
  }),

  /**
   * Membatalkan pesanan sendiri, selama klub belum menyiapkannya. Stok dan
   * poin dikembalikan — tanpa itu tiap pembatalan diam-diam menghanguskan
   * barang dan saldo sekaligus.
   */
  http.post('/api/merch-orders/:id/cancel', async ({ params }) => {
    await latency()
    const order = getMerchOrder(String(params.id))
    if (!order) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Pesanan tidak ditemukan.' },
        { status: 404 },
      )
    }
    if (order.status !== 'menunggu') {
      return HttpResponse.json(
        {
          code: 'TOO_LATE',
          message: `Pesanan sudah ${MERCH_STATUS_LABEL[order.status].toLowerCase()} — hubungi klub lewat menu Bantuan.`,
        },
        { status: 409 },
      )
    }

    const cancelled: MerchOrder = { ...order, status: 'batal' }
    saveMerchOrder(cancelled)
    refundMerchOrder(order)
    persistDb()
    return HttpResponse.json(cancelled)
  }),

  /* ── Toko: sisi admin ──────────────────────────────────────────────── */

  http.get('/api/admin/merch', async () => {
    await latency()
    if (!isAdmin()) return forbidden()
    // Termasuk yang nonaktif — admin perlu melihat apa yang ia sembunyikan.
    return HttpResponse.json(store.merch)
  }),

  http.post('/api/admin/merch', async ({ request }) => {
    await latency()
    if (!isAdmin()) return forbidden()
    const draft = (await request.json()) as MerchItemDraft
    const invalid = validateMerchDraft(draft)
    if (invalid) {
      return HttpResponse.json({ code: 'INVALID', message: invalid }, { status: 400 })
    }
    store.merch.push(itemFromDraft(draft, `m-${Date.now().toString(36)}`))
    persistDb()
    return HttpResponse.json(store.merch, { status: 201 })
  }),

  http.patch('/api/admin/merch/:id', async ({ params, request }) => {
    await latency()
    if (!isAdmin()) return forbidden()
    const existing = findMerchItem(String(params.id))
    if (!existing) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Barang tidak ditemukan.' },
        { status: 404 },
      )
    }
    const draft = (await request.json()) as MerchItemDraft
    const invalid = validateMerchDraft(draft)
    if (invalid) {
      return HttpResponse.json({ code: 'INVALID', message: invalid }, { status: 400 })
    }
    // Foto dan id dipertahankan: mengubah harga tidak boleh mengganti gambar.
    replaceMerchItem({ ...itemFromDraft(draft, existing.id), photo: existing.photo })
    persistDb()
    return HttpResponse.json(store.merch)
  }),

  http.get('/api/admin/merch-orders', async () => {
    await latency()
    if (!isAdmin()) return forbidden()
    return HttpResponse.json(listMerchOrders())
  }),

  http.patch('/api/admin/merch-orders/:id', async ({ params, request }) => {
    await latency()
    if (!isAdmin()) return forbidden()
    const order = getMerchOrder(String(params.id))
    if (!order) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Pesanan tidak ditemukan.' },
        { status: 404 },
      )
    }
    const { status } = (await request.json()) as { status: MerchOrderStatus }
    if (!MERCH_FLOW.includes(status)) {
      return HttpResponse.json(
        { code: 'INVALID', message: 'Status tidak dikenal.' },
        { status: 400 },
      )
    }

    saveMerchOrder({ ...order, status })
    // Pembatalan oleh klub mengembalikan stok dan poin, sama seperti oleh user.
    if (status === 'batal' && order.status !== 'batal') refundMerchOrder(order)
    persistDb()
    return HttpResponse.json(listMerchOrders())
  }),

  /* ── Aduan & pesan ke admin ────────────────────────────────────────────
   * Satu utas dipakai bersama anggota dan admin. Statusnya mengikuti
   * percakapannya (lihat `lib/complaints`), bukan tombol terpisah.
   * ──────────────────────────────────────────────────────────────────── */

  http.get('/api/complaints', async () => {
    await latency()
    // Anggota hanya melihat aduannya sendiri; admin melihat semuanya.
    const rows = isAdmin()
      ? store.complaints
      : store.complaints.filter((c) => c.userId === caller().id)
    return HttpResponse.json(sortByActivity(rows))
  }),

  http.get('/api/complaints/:id', async ({ params }) => {
    await latency()
    const complaint = findComplaint(String(params.id))
    if (!complaint) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Aduan tidak ditemukan.' },
        { status: 404 },
      )
    }
    if (!isAdmin() && complaint.userId !== caller().id) return forbidden()
    return HttpResponse.json(complaint)
  }),

  http.post('/api/complaints', async ({ request }) => {
    await latency()
    const draft = (await request.json()) as ComplaintDraft & { body: string }
    const invalid = validateDraft({ subject: draft.subject, body: draft.body })
    if (invalid) {
      return HttpResponse.json({ code: 'INVALID', message: invalid }, { status: 400 })
    }

    const now = new Date().toISOString()
    const id = `c-${Date.now().toString(36)}`
    // Satu kali baca: kepala aduan dan pesan pembukanya harus menyebut orang
    // yang sama, kalau tidak utasnya tampak ditulis dua orang berbeda.
    const me = caller()
    const complaint: Complaint = {
      id,
      code: complaintCode(),
      userId: me.id,
      userName: me.name,
      category: draft.category,
      subject: draft.subject.trim(),
      status: 'baru',
      createdAt: now,
      updatedAt: now,
      relatedKind: draft.relatedKind,
      relatedId: draft.relatedId,
      relatedLabel: labelForRelated(draft.relatedKind, draft.relatedId),
      messages: [
        {
          id: `cm-${Date.now().toString(36)}`,
          complaintId: id,
          authorRole: 'member',
          authorName: me.name,
          body: draft.body.trim(),
          sentAt: now,
        },
      ],
    }
    saveComplaint(complaint)
    persistDb()
    return HttpResponse.json(complaint, { status: 201 })
  }),

  http.post('/api/complaints/:id/messages', async ({ params, request }) => {
    await latency()
    const complaint = findComplaint(String(params.id))
    if (!complaint) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Aduan tidak ditemukan.' },
        { status: 404 },
      )
    }
    if (!isAdmin() && complaint.userId !== caller().id) return forbidden()

    const { body } = (await request.json()) as { body: string }
    const invalid = validateReply(body)
    if (invalid) {
      return HttpResponse.json({ code: 'INVALID', message: invalid }, { status: 400 })
    }

    const me = caller()
    const role: Role = me.role
    const now = new Date().toISOString()
    const updated: Complaint = {
      ...complaint,
      // Status ikut percakapan: balasan klub memindahkannya dari "baru", dan
      // anggota yang menulis lagi membuka kembali yang sudah ditutup.
      status: statusAfterReply(complaint.status, role),
      updatedAt: now,
      messages: [
        ...complaint.messages,
        {
          id: `cm-${Date.now().toString(36)}`,
          complaintId: complaint.id,
          authorRole: role,
          authorName: role === 'admin' ? 'Admin DBTC' : me.name,
          body: body.trim(),
          sentAt: now,
        },
      ],
    }
    saveComplaint(updated)
    persistDb()
    return HttpResponse.json(updated)
  }),

  /** Menutup atau membuka kembali aduan — hanya admin. */
  http.patch('/api/complaints/:id/status', async ({ params, request }) => {
    await latency()
    if (!isAdmin()) return forbidden()
    const complaint = findComplaint(String(params.id))
    if (!complaint) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Aduan tidak ditemukan.' },
        { status: 404 },
      )
    }
    const { status } = (await request.json()) as { status: ComplaintStatus }
    if (!COMPLAINT_FLOW.includes(status)) {
      return HttpResponse.json(
        { code: 'INVALID', message: 'Status tidak dikenal.' },
        { status: 400 },
      )
    }
    const updated: Complaint = { ...complaint, status, updatedAt: new Date().toISOString() }
    saveComplaint(updated)
    persistDb()
    return HttpResponse.json(updated)
  }),

  /** Dipakai UI untuk tahu apa yang sudah diikuti user tanpa menebak. */
  http.get('/api/memberships', async () => {
    await latency()
    return HttpResponse.json({
      teams: store.teams.filter((t) => membership.hasJoinedTeam(t.id)).map((t) => t.id),
      tournaments: store.tournaments.filter((t) => membership.hasRegistered(t.id)).map((t) => t.id),
      openMatches: store.openMatches
        .filter((m) => m.players.some((p) => p.id === CURRENT_USER.id))
        .map((m) => m.id),
    })
  }),
]
