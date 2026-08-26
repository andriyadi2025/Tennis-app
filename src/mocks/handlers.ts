import { http, HttpResponse, delay } from 'msw'
import type {
  AppNotification,
  Booking,
  ChatMessage,
  PaymentMethod,
  Review,
  ReviewSummary,
  Slot,
  Sport,
  Venue,
} from '@/types'
import { computePrice } from '@/lib/pricing'
import { toRange } from '@/lib/slots'
import { addWeeks, parseISO } from '@/lib/dates'
import {
  store,
  buildSlots,
  claimSlots,
  findCourt,
  findVenue,
  getBooking,
  isCursedSlot,
  isSlotAvailable,
  listBookings,
  membership,
  recomputeVenueRating,
  saveBooking,
} from './db'
import { CURRENT_USER } from './seed'

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
  let out = 'LPG-'
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
}

interface PayBody {
  method: PaymentMethod
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
    return HttpResponse.json(CURRENT_USER)
  }),

  http.post('/api/auth/login', async ({ request }) => {
    await latency()
    const body = (await request.json()) as { phone?: string }
    const phone = (body.phone ?? '').replace(/\D/g, '')
    if (phone.length < 9) {
      return HttpResponse.json(
        { message: 'Nomor HP tidak valid. Contoh: 0812 8845 1190.' },
        { status: 422 },
      )
    }
    return HttpResponse.json({ user: CURRENT_USER, token: 'mock-token' })
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
      return HttpResponse.json(booking)
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
    const confirmed: Booking = {
      ...booking,
      status: 'confirmed',
      paymentMethod: body.method,
      paymentDeadline: null,
    }
    saveBooking(confirmed)
    return HttpResponse.json(confirmed)
  }),

  http.post('/api/bookings/:id/split', async ({ params, request }) => {
    await latency()
    const booking = getBooking(String(params.id))
    if (!booking) return HttpResponse.json({ message: 'Booking tidak ditemukan.' }, { status: 404 })
    const body = (await request.json()) as { splitBill: Booking['splitBill'] }
    const next = { ...booking, splitBill: body.splitBill }
    saveBooking(next)
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
    return HttpResponse.json(match)
  }),

  http.post('/api/open-matches/:id/leave', async ({ params }) => {
    await latency()
    const match = store.openMatches.find((m) => m.id === String(params.id))
    if (!match)
      return HttpResponse.json({ message: 'Open match tidak ditemukan.' }, { status: 404 })
    match.players = match.players.filter((p) => p.id !== CURRENT_USER.id)
    return HttpResponse.json(match)
  }),

  http.post('/api/notifications/:id/read', async ({ params }) => {
    await latency()
    const item = store.notifications.find((n) => n.id === String(params.id))
    if (!item) return HttpResponse.json({ message: 'Notifikasi tidak ditemukan.' }, { status: 404 })
    item.read = true
    return HttpResponse.json(item)
  }),

  http.post('/api/notifications/read-all', async () => {
    await latency()
    store.notifications.forEach((n) => {
      n.read = true
    })
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
    return HttpResponse.json(team)
  }),

  /** Ajakan sparring — dicatat sebagai notifikasi, belum ada inbox terpisah. */
  http.post('/api/teams/:id/spar', async ({ params }) => {
    await latency()
    const team = store.teams.find((t) => t.id === String(params.id))
    if (!team) return HttpResponse.json({ message: 'Tim tidak ditemukan.' }, { status: 404 })
    const notification: AppNotification = {
      id: `n-${Date.now().toString(36)}`,
      kind: 'match',
      title: `Ajakan sparring terkirim ke ${team.name}`,
      body: 'Kami kabari begitu mereka membalas.',
      createdAt: new Date().toISOString(),
      read: false,
      href: `/team/${team.id}`,
    }
    store.notifications.unshift(notification)
    return HttpResponse.json(notification, { status: 201 })
  }),

  http.post('/api/tournaments/:id/register', async ({ params }) => {
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
    membership.register(tournament.id)
    tournament.slotsTaken += 1
    return HttpResponse.json(tournament)
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
