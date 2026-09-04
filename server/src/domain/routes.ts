import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { userForSession } from '../auth.ts'
import { db } from '../db.ts'
import * as store from './store.ts'
import type { DomainUser } from './store.ts'
import { buildSlots, hoursOf } from './slots.ts'
import { heartbeat, openStream, publish, subscribe } from './events.ts'
import { createCharge, findPayment, listPayments, paymentView, applyWebhook } from './payments.ts'
import { paymentProvider, SimulatorProvider } from '../payments/index.ts'
import type { PaymentKind, PaymentStatus } from '../payments/index.ts'
import type {
  AppNotification,
  Booking,
  ClubSettings,
  Complaint,
  ComplaintMessage,
  Court,
  CourtDraft,
  MerchItem,
  MerchItemDraft,
  MerchOrder,
  MerchOrderStatus,
  MerchPayMode,
  PaymentMethod,
  Review,
  ReviewSummary,
  Sport,
  Tournament,
  TournamentRegistration,
  User,
  Venue,
} from '../../../shared/types.ts'
import { computePrice } from '../../../shared/pricing.ts'
import { toRange } from '../../../shared/slots.ts'
import { addWeeks, parseISO } from '../../../shared/dates.ts'
import { tierFor } from '../../../shared/points.ts'
import {
  deriveActivities,
  matchesPlayed,
  settleActivities,
  tallyActivities,
  totalActivityPoints,
} from '../../../shared/activities.ts'
import {
  decrementStock,
  findVariant,
  orderBlocker,
  quoteOrder,
  restoreStock,
} from '../../../shared/merch.ts'
import {
  sortByActivity,
  statusAfterReply,
  validateDraft,
  validateReply,
} from '../../../shared/complaints.ts'

export const domainRoutes = Router()

/** Hold pembayaran 10 menit. */
export const PAYMENT_HOLD_MS = 10 * 60 * 1_000

export const ADD_ONS = [
  { id: 'a-shuttlecock', label: 'Shuttlecock (1 tube)', priceIdr: 95_000 },
  { id: 'a-raket', label: 'Sewa raket', priceIdr: 25_000 },
  { id: 'a-bola', label: 'Sewa bola', priceIdr: 20_000 },
  { id: 'a-rompi', label: 'Rompi tim (10 pcs)', priceIdr: 30_000 },
  { id: 'a-air', label: 'Air mineral 1 dus', priceIdr: 35_000 },
] as const

/* ── Bantuan ─────────────────────────────────────────────────────────────── */

function fail(res: Response, status: number, code: string, message: string, extra = {}) {
  return res.status(status).json({ code, message, ...extra })
}

function bearer(req: Request): string | null {
  // Token boleh datang lewat header (biasa) atau query (EventSource, yang
  // tidak bisa memasang header sendiri).
  const header = req.header('authorization')
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || null
  const query = req.query.token
  return typeof query === 'string' && query ? query : null
}

/**
 * Setiap endpoint domain butuh sesi.
 *
 * Inilah bedanya dengan server tiruan yang digantikannya: di browser hanya
 * ada satu orang, jadi kepemilikan tidak pernah diuji. Di sini booking, poin,
 * dan aduan selalu milik seseorang, dan siapa itu ditentukan token — bukan
 * badan permintaan yang bisa ditulis siapa saja.
 */
async function requireUser(req: Request, res: Response): Promise<DomainUser | null> {
  const token = bearer(req)
  const row = token ? await userForSession(token) : undefined
  if (!row) {
    fail(res, 401, 'UNAUTHENTICATED', 'Sesi tidak berlaku. Masuk dulu.')
    return null
  }
  return { id: row.id, name: row.name, role: row.role === 'admin' ? 'admin' : 'member' }
}

async function requireAdmin(req: Request, res: Response): Promise<DomainUser | null> {
  const user = await requireUser(req, res)
  if (!user) return null
  if (user.role !== 'admin') {
    fail(res, 403, 'FORBIDDEN', 'Hanya admin klub yang boleh mengubah pengaturan ini.')
    return null
  }
  return user
}

function shortCode(prefix: string, length = 6): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = `${prefix}-`
  for (let i = 0; i < length; i += 1) {
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

function findCourt(venue: Venue, courtId: string): Court | undefined {
  return venue.courts.find((c) => c.id === courtId)
}

/* ── Profil & poin ───────────────────────────────────────────────────────── */

domainRoutes.get('/me', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const profile = await store.ensureProfile(user)
  const feed = await activityFeed(user, profile)
  res.json({ ...profile, matchesPlayed: feed.matchesPlayed })
})

domainRoutes.post('/me/points', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  await store.ensureProfile(user)
  const { delta } = req.body as { delta: number }
  await store.addPoints(user.id, Number(delta) || 0)
  res.json(await store.ensureProfile(user))
})

/* ── Venue, slot, ulasan ─────────────────────────────────────────────────── */

domainRoutes.get('/venues', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return

  const q = String(req.query.q ?? '').toLowerCase()
  const sport = req.query.sport as Sport | undefined
  const minPrice = Number(req.query.minPrice ?? 0)
  const maxPrice = Number(req.query.maxPrice ?? Number.MAX_SAFE_INTEGER)
  const maxDistance = Number(req.query.maxDistance ?? Number.MAX_SAFE_INTEGER)
  const indoorOnly = req.query.indoor === '1'

  const rows = (await store.listVenues()).filter((venue) => {
    if (sport && !venue.sport.includes(sport)) return false
    if (venue.pricePerHourIdr < minPrice || venue.pricePerHourIdr > maxPrice) return false
    if (venue.distanceKm > maxDistance) return false
    if (indoorOnly && !venue.indoor) return false
    if (q) {
      const haystack = [venue.name, venue.address, venue.district, ...venue.sport]
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })

  res.json(rows.sort((a, b) => a.distanceKm - b.distanceKm))
})

domainRoutes.get('/venues/:id', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const venue = await store.findVenue(req.params.id)
  if (!venue) return fail(res, 404, 'NOT_FOUND', 'Venue tidak ditemukan.')
  res.json(venue)
})

domainRoutes.get('/venues/:id/slots', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return

  const venue = await store.findVenue(req.params.id)
  if (!venue) return fail(res, 404, 'NOT_FOUND', 'Venue tidak ditemukan.')

  const courtId = String(req.query.courtId ?? venue.courts[0]?.id ?? '')
  const date = req.query.date
  const court = findCourt(venue, courtId)
  if (!court || typeof date !== 'string') {
    return fail(res, 400, 'BAD_REQUEST', 'Lapangan atau tanggal tidak valid.')
  }

  const settings = await store.getSettings()
  const taken = await store.takenSlots(court.id)
  res.json(buildSlots(venue, court, date, settings, taken))
})

domainRoutes.get('/venues/:id/reviews', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const reviews = await store.listReviews(req.params.id)
  res.json({ reviews, summary: summarise(reviews) })
})

const reviewSchema = z.object({ rating: z.number().min(1).max(5), body: z.string().trim().min(1) })

domainRoutes.post('/venues/:id/reviews', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const parsed = reviewSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 422, 'INVALID_BODY', 'Rating dan ulasan wajib diisi.')

  const review = await store.addReview(
    req.params.id,
    user,
    Math.round(parsed.data.rating),
    parsed.data.body,
  )
  await store.recomputeVenueRating(req.params.id)
  res.status(201).json(review)
})

/* ── Booking ─────────────────────────────────────────────────────────────── */

domainRoutes.get('/addons', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  res.json(ADD_ONS)
})

/**
 * Cek ketersediaan sekumpulan slot di masa depan — dipakai toggle
 * "ulangi tiap Jumat" sebelum booking dikunci.
 */
domainRoutes.post('/availability/check', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return

  const body = req.body as { courtId: string; startsAt: string[]; weeks: number }
  const taken = await store.takenSlots(body.courtId)
  const conflicts: { weekOffset: number; startsAt: string[] }[] = []

  for (let week = 1; week < Math.max(1, Math.floor(body.weeks)); week += 1) {
    const clashes = body.startsAt
      .map((iso) => addWeeks(parseISO(iso), week).toISOString())
      .filter((iso) => taken.has(iso))
    if (clashes.length > 0) conflicts.push({ weekOffset: week, startsAt: clashes })
  }
  res.json({ conflicts })
})

/** draft → summary: server menghitung ulang harga, klien tidak dipercaya. */
domainRoutes.post('/bookings', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const profile = await store.ensureProfile(user)

  const body = req.body as {
    venueId: string
    courtId: string
    startsAt: string[]
    recurrenceWeeks: number
    addOnIds: string[]
    pointsRedeemed: number
    purpose?: Booking['purpose']
  }

  const venue = await store.findVenue(body.venueId)
  const court = venue ? findCourt(venue, body.courtId) : undefined
  if (!venue || !court) return fail(res, 404, 'NOT_FOUND', 'Venue atau lapangan tidak ditemukan.')

  const range = toRange(body.startsAt)
  if (!range) return fail(res, 400, 'BAD_REQUEST', 'Belum ada jam yang dipilih.')

  const taken = await store.takenSlots(court.id)
  const unavailable = body.startsAt.filter((iso) => taken.has(iso))
  if (unavailable.length > 0) {
    return fail(res, 409, 'SLOT_TAKEN', 'Slot keburu diambil orang lain.', {
      startsAt: unavailable,
    })
  }

  /*
   * Poin yang ditukar dibatasi saldo sungguhan, bukan angka kiriman klien.
   * Server tiruan dulu mempercayainya karena saldonya juga di browser; di
   * sini saldo itu milik server, dan mempercayainya berarti memberi potongan
   * yang tidak dibayar poin siapa pun.
   */
  const requested = Math.max(0, Math.floor(Number(body.pointsRedeemed) || 0))
  const redeemed = Math.min(requested, profile.points)

  const settings = await store.getSettings()
  const slots = buildSlots(venue, court, range.startsAt, settings, taken).filter((s) =>
    body.startsAt.includes(s.startsAt),
  )
  const addOns = ADD_ONS.filter((a) => body.addOnIds?.includes(a.id)).map((a) => ({ ...a, qty: 1 }))
  const weeks = Math.max(1, Math.floor(body.recurrenceWeeks) || 1)
  const price = computePrice({ slots, addOns, weeks })
  const final = computePrice({ slots, addOns, weeks, discountIdr: (redeemed / 100) * 10_000 })

  const booking: Booking = {
    id: store.uid('bk'),
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
    code: shortCode('DBTC'),
    subtotalIdr: price.subtotalIdr,
    pointsRedeemed: redeemed,
    discountIdr: final.discountIdr,
    serviceFeeIdr: final.serviceFeeIdr,
    totalIdr: final.totalIdr,
    createdAt: store.now(),
    paymentDeadline: new Date(Date.now() + PAYMENT_HOLD_MS).toISOString(),
  }

  await store.saveBooking(user.id, booking)
  res.status(201).json(booking)
})

domainRoutes.get('/bookings', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  res.json(await store.listBookings(user.id))
})

domainRoutes.get('/bookings/:id', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const booking = await store.getBooking(req.params.id, user.id)
  if (!booking) return fail(res, 404, 'NOT_FOUND', 'Booking tidak ditemukan.')
  res.json(booking)
})

/** awaitingPayment → confirmed. Menolak hold yang sudah lewat. */
/**
 * Membayar booking — lewat gerbang, bukan langsung dikonfirmasi.
 *
 * Dulu endpoint ini yang mengunci slot dan memberi poin. Itu berarti app
 * menyatakan lunas tanpa ada uang yang berpindah ke mana pun. Sekarang ia
 * hanya membuat tagihan; yang mengonfirmasi booking adalah webhook penyedia,
 * setelah pembayarannya benar-benar masuk.
 */
domainRoutes.post('/bookings/:id/pay', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return

  const booking = await store.getBooking(req.params.id, user.id)
  if (!booking) return fail(res, 404, 'NOT_FOUND', 'Booking tidak ditemukan.')
  if (booking.status === 'confirmed') return res.json({ booking, payment: null })
  if (booking.status !== 'awaitingPayment') {
    return fail(res, 409, 'STALE_DRAFT', 'Booking ini sudah tidak bisa dibayar.')
  }
  if (booking.paymentDeadline && new Date(booking.paymentDeadline).getTime() < Date.now()) {
    await store.saveBooking(user.id, { ...booking, status: 'expired' })
    return fail(res, 410, 'PAYMENT_EXPIRED', 'Waktu pembayaran habis. Slot dilepas kembali.')
  }

  /*
   * Slot diperiksa sebelum tagihan dibuat. Menagih orang untuk jam yang sudah
   * diambil orang lain berarti harus mengembalikan uangnya kemudian, dan
   * pengembalian dana adalah hal yang paling baik dihindari sejak awal.
   */
  const hours = hoursOf(booking.range.startsAt, booking.range.hours)
  const taken = await store.takenSlots(booking.courtId)
  const stolen = hours.filter((iso) => taken.has(iso))
  if (stolen.length > 0) {
    return fail(
      res,
      409,
      'SLOT_TAKEN',
      'Slot ini baru saja diambil orang lain. Pilih jam lain ya.',
      {
        startsAt: stolen,
      },
    )
  }

  const { method } = req.body as { method: PaymentMethod }
  const account = await userForSession(bearer(req)!)
  const payment = await createCharge(
    { id: user.id, name: user.name, email: account?.email ?? null, phone: account?.phone ?? null },
    {
      kind: 'booking',
      refId: booking.id,
      amountIdr: booking.totalIdr,
      description: `${booking.venueName} · ${booking.courtName}`,
    },
    method ?? 'qris',
  )

  res.status(201).json({ booking, payment })
})

domainRoutes.post('/bookings/:id/split', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const booking = await store.getBooking(req.params.id, user.id)
  if (!booking) return fail(res, 404, 'NOT_FOUND', 'Booking tidak ditemukan.')

  const { splitBill } = req.body as { splitBill: Booking['splitBill'] }
  const next = { ...booking, splitBill }
  await store.saveBooking(user.id, next)
  res.json(next)
})

/* ── Komunitas ───────────────────────────────────────────────────────────── */

domainRoutes.get('/open-matches', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const sport = req.query.sport as Sport | undefined
  const rows = await store.listOpenMatches()
  res.json(sport ? rows.filter((m) => m.sport === sport) : rows)
})

domainRoutes.get('/open-matches/:id', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const match = await store.findOpenMatch(req.params.id)
  if (!match) return fail(res, 404, 'NOT_FOUND', 'Open match tidak ditemukan.')
  res.json(match)
})

domainRoutes.post('/open-matches/:id/join', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const match = await store.findOpenMatch(req.params.id)
  if (!match) return fail(res, 404, 'NOT_FOUND', 'Open match tidak ditemukan.')
  if (match.players.length >= match.slotsTotal) {
    return fail(res, 409, 'MATCH_FULL', 'Slot open match ini sudah penuh.')
  }
  await store.joinMatch(match.id, user)
  res.json(await store.findOpenMatch(match.id))
})

domainRoutes.post('/open-matches/:id/leave', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  await store.leaveMatch(req.params.id, user.id)
  const match = await store.findOpenMatch(req.params.id)
  if (!match) return fail(res, 404, 'NOT_FOUND', 'Open match tidak ditemukan.')
  res.json(match)
})

domainRoutes.get('/teams', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  res.json(await store.listTeams())
})

domainRoutes.get('/teams/:id', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const team = await store.findTeam(req.params.id)
  if (!team) return fail(res, 404, 'NOT_FOUND', 'Tim tidak ditemukan.')
  res.json(team)
})

const teamSchema = z.object({
  name: z.string().trim().min(2).max(60),
  sport: z.string().min(1),
  city: z.string().trim().min(2).max(60),
  about: z.string().trim().max(400).default(''),
})

domainRoutes.post('/teams', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const parsed = teamSchema.safeParse(req.body)
  if (!parsed.success) {
    return fail(res, 422, 'INVALID_BODY', 'Nama tim dan kota wajib diisi, minimal 2 karakter.')
  }
  const team = await store.createTeam({ ...parsed.data, sport: parsed.data.sport as Sport }, user)
  res.status(201).json(team)
})

domainRoutes.patch('/teams/:id', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const team = await store.findTeam(req.params.id)
  if (!team) return fail(res, 404, 'NOT_FOUND', 'Tim tidak ditemukan.')
  /*
   * Hanya pembuatnya. Tim bawaan tidak punya pemilik akun di sini, jadi
   * tidak ada yang bisa mengubahnya — itu memang benar: yang punya bukan
   * salah satu pengguna app ini.
   */
  if (team.ownerId !== user.id) {
    return fail(res, 403, 'NOT_OWNER', 'Hanya pembuat tim yang bisa mengubahnya.')
  }

  const parsed = teamSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 422, 'INVALID_BODY', 'Data tim tidak lengkap.')
  res.json(await store.updateTeam(team.id, { ...parsed.data, sport: parsed.data.sport as Sport }))
})

domainRoutes.post('/teams/:id/leave', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const team = await store.findTeam(req.params.id)
  if (!team) return fail(res, 404, 'NOT_FOUND', 'Tim tidak ditemukan.')
  /*
   * Pembuat tidak bisa keluar dari timnya sendiri. Tim tanpa pemilik tidak
   * bisa diubah siapa pun lagi, dan ajakan sparring atas namanya tetap
   * berjalan tanpa ada yang bertanggung jawab menjawabnya.
   */
  if (team.ownerId === user.id) {
    return fail(
      res,
      409,
      'OWNER_CANNOT_LEAVE',
      'Kamu pembuat tim ini. Serahkan dulu ke anggota lain, atau bubarkan timnya.',
    )
  }
  await store.leaveTeam(team.id, user.id)
  res.json(await store.findTeam(team.id))
})

domainRoutes.post('/teams/:id/join', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  await store.joinTeam(req.params.id, user)
  const team = await store.findTeam(req.params.id)
  if (!team) return fail(res, 404, 'NOT_FOUND', 'Tim tidak ditemukan.')
  res.json(team)
})

domainRoutes.get('/memberships', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const registrations = await store.listRegistrations(user.id)
  res.json({
    teams: await store.teamsJoinedBy(user.id),
    tournaments: registrations.map((r) => r.tournamentId),
    openMatches: await store.matchesJoinedBy(user.id),
  })
})

/* ── Turnamen ────────────────────────────────────────────────────────────── */

domainRoutes.get('/tournaments', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  res.json(await store.listTournaments())
})

domainRoutes.get('/tournaments/registrations', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  res.json(await store.listRegistrations(user.id))
})

domainRoutes.post('/tournaments/:id/register', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  await store.ensureProfile(user)

  const tournament = await store.findTournament(req.params.id)
  if (!tournament) return fail(res, 404, 'NOT_FOUND', 'Turnamen tidak ditemukan.')
  if (await store.hasRegistered(user.id, tournament.id)) {
    return fail(res, 409, 'ALREADY_REGISTERED', 'Kamu sudah terdaftar di turnamen ini.')
  }
  if (tournament.slotsTaken >= tournament.slotsTotal) {
    return fail(res, 409, 'TOURNAMENT_FULL', 'Kuota turnamen ini sudah penuh.')
  }

  const { method } = req.body as { method: PaymentMethod }
  const registration: TournamentRegistration = {
    id: store.uid('trg'),
    tournamentId: tournament.id,
    tournamentName: tournament.name,
    entryFeeIdr: tournament.entryFeeIdr,
    paymentMethod: method,
    paymentStatus: method === 'onsite' ? 'menunggu' : 'lunas',
    code: shortCode('TRN', 4),
    registeredAt: store.now(),
  }

  await db.transaction(async (tx) => {
    await store.saveRegistration(user.id, registration, tx)
    await store.bumpTournamentSlots(tournament.id, tx)
  })

  const fresh = (await store.findTournament(tournament.id)) as Tournament
  res.status(201).json({ tournament: fresh, registration })
})

/* ── Notifikasi ──────────────────────────────────────────────────────────── */

domainRoutes.get('/notifications', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  await store.ensureProfile(user)
  res.json(await store.listNotifications(user.id))
})

domainRoutes.post('/notifications/:id/read', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const row = await store.markNotificationRead(req.params.id, user.id)
  if (!row) return fail(res, 404, 'NOT_FOUND', 'Notifikasi tidak ditemukan.')
  res.json(row)
})

domainRoutes.post('/notifications/read-all', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  await store.markAllNotificationsRead(user.id)
  res.json(await store.listNotifications(user.id))
})

/* ── Obrolan, dengan realtime ────────────────────────────────────────────── */

domainRoutes.get('/chats/:id', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const chat = await store.findChat(req.params.id)
  if (!chat) return fail(res, 404, 'NOT_FOUND', 'Obrolan tidak ditemukan.')
  res.json(chat)
})

domainRoutes.post('/chats/:id/messages', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const body = String((req.body as { body?: string }).body ?? '').trim()
  if (!body) return fail(res, 422, 'INVALID_BODY', 'Pesan tidak boleh kosong.')

  const chat = await store.findChat(req.params.id)
  if (!chat) return fail(res, 404, 'NOT_FOUND', 'Obrolan tidak ditemukan.')

  const message = await store.addChatMessage(chat.id, user, body)
  // Pengirim tidak diberi tahu: ia sudah punya hasilnya dari balasan ini.
  publish('chat', chat.id, 'message', { id: message.id }, user.id)
  res.status(201).json(message)
})

/** Aliran perubahan satu utas obrolan. */
domainRoutes.get('/chats/:id/stream', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return

  const chat = await store.findChat(req.params.id)
  if (!chat) return fail(res, 404, 'NOT_FOUND', 'Obrolan tidak ditemukan.')

  openStream(res)
  const stopHeartbeat = heartbeat(res)
  const unsubscribe = subscribe('chat', chat.id, user.id, res)
  req.on('close', () => {
    stopHeartbeat()
    unsubscribe()
  })
})

/* ── Sparring, dengan negosiasi waktu ────────────────────────────────────── */

domainRoutes.get('/sparring', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  res.json(await store.listSparring(await store.myTeamIds(user.id)))
})

domainRoutes.post('/teams/:id/spar', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const team = await store.findTeam(req.params.id)
  if (!team) return fail(res, 404, 'NOT_FOUND', 'Tim tidak ditemukan.')

  const { message, proposedAt, venueName, fromTeamId } = req.body as {
    message?: string
    proposedAt?: string | null
    venueName?: string | null
    fromTeamId?: string
  }

  /*
   * Tim pengirim harus tim yang benar-benar diikuti user. Dulu satu tim
   * ditanam di kode untuk semua orang, jadi setiap ajakan mengaku datang dari
   * tim yang sama — termasuk dari orang yang bukan anggotanya.
   */
  const mine = await store.myTeamIds(user.id)
  if (mine.size === 0) {
    return fail(
      res,
      409,
      'NO_TEAM',
      'Kamu belum punya tim. Buat tim dulu sebelum mengajak sparring.',
    )
  }
  const senderId = fromTeamId ?? [...mine][0]!
  if (!mine.has(senderId)) {
    return fail(res, 403, 'NOT_MEMBER', 'Kamu bukan anggota tim yang dipakai mengirim ajakan.')
  }
  if (senderId === team.id) {
    return fail(res, 409, 'SAME_TEAM', 'Tim tidak bisa mengajak sparring dirinya sendiri.')
  }
  const sender = await store.findTeam(senderId)
  if (!sender) return fail(res, 404, 'NOT_FOUND', 'Tim pengirim tidak ditemukan.')

  const invite = {
    id: store.uid('sp'),
    direction: 'keluar' as const,
    fromTeamId: sender.id,
    fromTeamName: sender.name,
    toTeamId: team.id,
    toTeamName: team.name,
    sport: team.sport,
    proposedAt: proposedAt ?? null,
    venueName: venueName ?? null,
    message: message?.trim() ?? '',
    status: 'menunggu' as const,
    createdAt: store.now(),
  }
  await store.saveSparring(invite)

  if (invite.proposedAt) {
    await store.addProposal({
      id: store.uid('spp'),
      sparringId: invite.id,
      bySide: 'tuan',
      byName: sender.name,
      proposedAt: invite.proposedAt,
      venueName: invite.venueName,
      note: invite.message,
      status: 'menunggu',
      createdAt: invite.createdAt,
    })
  }

  await store.pushNotification(user.id, {
    kind: 'community',
    title: 'Ajakan sparring terkirim',
    body: `Menunggu jawaban ${team.name}.`,
    href: '/sparring',
  })
  res.status(201).json(await store.findSparring(invite.id, await store.myTeamIds(user.id)))
})

domainRoutes.post('/sparring/:id/respond', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const invite = await store.findSparring(req.params.id, await store.myTeamIds(user.id))
  if (!invite) return fail(res, 404, 'NOT_FOUND', 'Ajakan tidak ditemukan.')

  const { accept } = req.body as { accept: boolean }
  /*
   * Menerima ajakan tanpa waktu yang disepakati tidak menghasilkan apa pun
   * yang bisa dicatat sebagai kegiatan. Kalau belum ada usulan waktu, yang
   * diminta adalah mengusulkannya — bukan menyetujui ruang kosong.
   */
  if (accept && !invite.proposedAt) {
    return fail(
      res,
      409,
      'NO_TIME_PROPOSED',
      'Belum ada usulan waktu. Usulkan jamnya dulu sebelum menerima.',
    )
  }

  await store.setSparringStatus(invite.id, accept ? 'diterima' : 'ditolak')
  if (accept) await store.acceptLatestProposal(invite.id)
  publish('sparring', invite.id, 'status', { accepted: Boolean(accept) }, user.id)
  res.json(await store.findSparring(invite.id, await store.myTeamIds(user.id)))
})

const proposalSchema = z.object({
  proposedAt: z.string().min(1),
  venueName: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
})

/**
 * Mengusulkan waktu baru — inti negosiasi.
 *
 * Usulan yang masuk **membuka kembali** ajakan yang sudah dijawab: waktu yang
 * berubah berarti kesepakatannya berubah, dan membiarkannya "diterima" akan
 * menampilkan kesepakatan atas jam yang sudah tidak berlaku.
 */
domainRoutes.post('/sparring/:id/propose', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return

  const invite = await store.findSparring(req.params.id, await store.myTeamIds(user.id))
  if (!invite) return fail(res, 404, 'NOT_FOUND', 'Ajakan tidak ditemukan.')
  if (invite.status === 'ditolak') {
    return fail(res, 409, 'ALREADY_DECLINED', 'Ajakan ini sudah ditolak.')
  }

  const parsed = proposalSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 422, 'INVALID_BODY', 'Waktu usulan wajib diisi.')

  const when = new Date(parsed.data.proposedAt)
  if (Number.isNaN(when.getTime())) {
    return fail(res, 422, 'INVALID_TIME', 'Format waktu tidak dikenal.')
  }
  if (when.getTime() < Date.now()) {
    return fail(res, 422, 'PAST_TIME', 'Waktu yang diusulkan sudah lewat.')
  }

  // Sisi mana yang mengusulkan diturunkan dari arah ajakannya, bukan dikirim
  // klien: yang menerima ajakan adalah "lawan", yang mengirim adalah "tuan".
  const side = invite.direction === 'keluar' ? 'tuan' : 'lawan'
  const proposal = {
    id: store.uid('spp'),
    sparringId: invite.id,
    bySide: side as 'tuan' | 'lawan',
    byName: side === 'tuan' ? invite.fromTeamName : invite.toTeamName,
    proposedAt: when.toISOString(),
    venueName: parsed.data.venueName ?? invite.venueName,
    note: parsed.data.note ?? '',
    status: 'menunggu' as const,
    createdAt: store.now(),
  }

  await db.transaction(async (tx) => {
    await store.supersedePendingProposals(invite.id, tx)
    await store.addProposal(proposal, tx)
    await store.saveSparring(
      {
        ...invite,
        proposedAt: proposal.proposedAt,
        venueName: proposal.venueName,
        status: 'menunggu',
      },
      tx,
    )
  })

  publish('sparring', invite.id, 'proposal', { id: proposal.id }, user.id)
  res.status(201).json({
    invite: await store.findSparring(invite.id, await store.myTeamIds(user.id)),
    proposals: await store.listProposals(invite.id),
  })
})

domainRoutes.get('/sparring/:id/proposals', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  res.json(await store.listProposals(req.params.id))
})

domainRoutes.get('/sparring/:id/stream', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  openStream(res)
  const stopHeartbeat = heartbeat(res)
  const unsubscribe = subscribe('sparring', req.params.id, user.id, res)
  req.on('close', () => {
    stopHeartbeat()
    unsubscribe()
  })
})

/* ── Catatan aktivitas ───────────────────────────────────────────────────── */

async function activityFeed(user: DomainUser, profile: User) {
  const settings = await store.getSettings()
  const activities = deriveActivities({
    bookings: await store.listBookings(user.id),
    openMatches: await store.listOpenMatches(),
    tournaments: await store.listTournaments(),
    registrations: await store.listRegistrations(user.id),
    sparring: await store.listSparring(await store.myTeamIds(user.id)),
    userId: user.id,
    points: settings.activityPoints,
  })

  const awarded = new Map<string, number>()
  for (const activity of activities) {
    const previous = await store.awardedPoints(user.id, activity.id)
    if (previous !== null) awarded.set(activity.id, previous)
  }

  const pending: { id: string; points: number }[] = []
  const { activities: settled, credited } = settleActivities(
    activities,
    (id) => awarded.get(id) ?? null,
    (id, points) => pending.push({ id, points }),
  )

  if (credited > 0) {
    await db.transaction(async (tx) => {
      for (const { id, points } of pending) {
        await store.markAwarded(user.id, id, points, tx)
      }
      const next = Math.max(0, profile.points + credited)
      await tx.run('UPDATE profiles SET points = ?, tier = ? WHERE user_id = ?', [
        next,
        tierFor(next),
        user.id,
      ])
    })
  }

  const tally = tallyActivities(settled)
  return {
    activities: settled,
    tally,
    matchesPlayed: matchesPlayed(tally),
    pointsFromActivities: totalActivityPoints(settled),
  }
}

domainRoutes.get('/activities', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const profile = await store.ensureProfile(user)
  res.json(await activityFeed(user, profile))
})

/* ── Toko ────────────────────────────────────────────────────────────────── */

domainRoutes.get('/merch', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const category = typeof req.query.category === 'string' ? req.query.category : null
  res.json(await store.listMerch({ category }))
})

domainRoutes.get('/merch/:id', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const item = await store.findMerchItem(req.params.id)
  if (!item) return fail(res, 404, 'NOT_FOUND', 'Barang tidak ditemukan.')
  res.json(item)
})

domainRoutes.post('/merch/:id/order', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const profile = await store.ensureProfile(user)

  const item = await store.findMerchItem(req.params.id)
  if (!item) return fail(res, 404, 'NOT_FOUND', 'Barang tidak ditemukan.')

  const body = req.body as {
    variantId: string
    qty: number
    payMode: MerchPayMode
    paymentMethod?: PaymentMethod
  }

  const blocker = orderBlocker({
    item,
    variantId: body.variantId,
    qty: body.qty,
    payMode: body.payMode,
    user: profile,
  })
  if (blocker) return fail(res, 409, 'ORDER_BLOCKED', blocker)

  const variant = findVariant(item, body.variantId)
  if (!variant) return fail(res, 409, 'ORDER_BLOCKED', 'Varian tidak ditemukan.')
  const quote = quoteOrder(item, body.qty, body.payMode)

  const order: MerchOrder = {
    id: store.uid('mo'),
    code: shortCode('TKO', 4),
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
    createdAt: store.now(),
  }

  // Stok dipotong dan poin dipindahkan bersama-sama: setengah jadi di sini
  // berarti barang hilang dari katalog tanpa ada yang membayarnya.
  await db.transaction(async (tx) => {
    await store.saveMerchItem(decrementStock(item, variant.id, quote.qty), tx)
    await store.saveMerchOrder(user.id, order, tx)
    /*
     * Hanya penebusan poin yang dipotong sekarang — tidak ada gerbang di
     * baliknya, poinnya memang langsung berpindah.
     *
     * Poin belanja **tidak** diberikan di sini. Pesanan yang dibayar uang
     * belum tentu jadi dibayar, dan memberi poin atas tagihan yang belum
     * masuk berarti mencetak poin dari niat. Kreditnya menyusul di jalur
     * penyelesaian pembayaran.
     */
    if (quote.pointsSpent > 0) {
      const next = Math.max(0, profile.points - quote.pointsSpent)
      await tx.run('UPDATE profiles SET points = ?, tier = ? WHERE user_id = ?', [
        next,
        tierFor(next),
        user.id,
      ])
    }
  })

  res.status(201).json(order)
})

domainRoutes.get('/merch-orders', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  res.json(await store.listMerchOrders(user.id))
})

/** Mengembalikan stok dan poin sebuah pesanan yang dibatalkan. */
async function refundOrder(userId: string, order: MerchOrder): Promise<void> {
  await db.transaction(async (tx) => {
    const item = await store.findMerchItem(order.itemId, tx)
    if (item) await store.saveMerchItem(restoreStock(item, order.variantId, order.qty), tx)

    const row = await tx.get<{ points: number }>('SELECT points FROM profiles WHERE user_id = ?', [
      userId,
    ])
    // Poin belanja yang sempat didapat ikut ditarik: kalau tidak, membeli
    // lalu membatalkan jadi cara mencetak poin tanpa membayar apa pun.
    const next = Math.max(0, Number(row?.points ?? 0) + order.pointsSpent - order.pointsEarned)
    await tx.run('UPDATE profiles SET points = ?, tier = ? WHERE user_id = ?', [
      next,
      tierFor(next),
      userId,
    ])
  })
}

domainRoutes.post('/merch-orders/:id/cancel', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return

  const found = await store.getMerchOrder(req.params.id)
  if (!found || found.userId !== user.id) {
    return fail(res, 404, 'NOT_FOUND', 'Pesanan tidak ditemukan.')
  }
  if (found.order.status !== 'menunggu') {
    return fail(
      res,
      409,
      'TOO_LATE',
      'Pesanan sudah diproses klub — hubungi klub lewat menu Bantuan.',
    )
  }

  const cancelled: MerchOrder = { ...found.order, status: 'batal' }
  await store.saveMerchOrder(user.id, cancelled)
  await refundOrder(user.id, found.order)
  res.json(cancelled)
})

/* ── Aduan ───────────────────────────────────────────────────────────────── */

domainRoutes.get('/complaints', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  await store.ensureProfile(user)
  const rows = await store.listComplaints(user.role === 'admin' ? {} : { userId: user.id })
  res.json(sortByActivity(rows))
})

domainRoutes.get('/complaints/:id', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const complaint = await store.findComplaint(req.params.id)
  if (!complaint) return fail(res, 404, 'NOT_FOUND', 'Aduan tidak ditemukan.')
  if (user.role !== 'admin' && complaint.userId !== user.id) {
    return fail(res, 403, 'FORBIDDEN', 'Aduan ini bukan milikmu.')
  }
  res.json(complaint)
})

domainRoutes.post('/complaints', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  await store.ensureProfile(user)

  const draft = req.body as {
    category: Complaint['category']
    subject: string
    body: string
    relatedKind: Complaint['relatedKind']
    relatedId: string | null
  }

  const invalid = validateDraft({ subject: draft.subject ?? '', body: draft.body ?? '' })
  if (invalid) return fail(res, 400, 'INVALID', invalid)

  const id = store.uid('c')
  const timestamp = store.now()
  const complaint: Complaint = {
    id,
    code: shortCode('ADU', 4),
    userId: user.id,
    userName: user.name,
    category: draft.category,
    subject: draft.subject.trim(),
    status: 'baru',
    createdAt: timestamp,
    updatedAt: timestamp,
    relatedKind: draft.relatedKind,
    relatedId: draft.relatedId,
    relatedLabel: await labelForRelated(user.id, draft.relatedKind, draft.relatedId),
    messages: [
      {
        id: store.uid('cm'),
        complaintId: id,
        authorRole: 'member',
        authorName: user.name,
        body: draft.body.trim(),
        sentAt: timestamp,
      },
    ],
  }

  await store.insertComplaint(complaint)
  res.status(201).json(complaint)
})

async function labelForRelated(
  userId: string,
  kind: Complaint['relatedKind'],
  id: string | null,
): Promise<string | null> {
  if (!kind || !id) return null
  if (kind === 'booking') {
    const booking = await store.getBooking(id, userId)
    return booking ? `${booking.venueName} · ${booking.code}` : null
  }
  const found = await store.getMerchOrder(id)
  return found ? `${found.order.itemName} · ${found.order.code}` : null
}

domainRoutes.post('/complaints/:id/messages', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return

  const complaint = await store.findComplaint(req.params.id)
  if (!complaint) return fail(res, 404, 'NOT_FOUND', 'Aduan tidak ditemukan.')
  if (user.role !== 'admin' && complaint.userId !== user.id) {
    return fail(res, 403, 'FORBIDDEN', 'Aduan ini bukan milikmu.')
  }

  const body = String((req.body as { body?: string }).body ?? '')
  const invalid = validateReply(body)
  if (invalid) return fail(res, 400, 'INVALID', invalid)

  const message: ComplaintMessage = {
    id: store.uid('cm'),
    complaintId: complaint.id,
    authorRole: user.role,
    authorName: user.role === 'admin' ? 'Admin DBTC' : user.name,
    body: body.trim(),
    sentAt: store.now(),
  }

  await db.transaction(async (tx) => {
    await store.addComplaintMessage(message, tx)
    await store.touchComplaint(complaint.id, statusAfterReply(complaint.status, user.role), tx)
  })

  publish('complaint', complaint.id, 'message', { id: message.id }, user.id)
  res.json(await store.findComplaint(complaint.id))
})

domainRoutes.get('/complaints/:id/stream', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  openStream(res)
  const stopHeartbeat = heartbeat(res)
  const unsubscribe = subscribe('complaint', req.params.id, user.id, res)
  req.on('close', () => {
    stopHeartbeat()
    unsubscribe()
  })
})

domainRoutes.patch('/complaints/:id/status', async (req, res) => {
  const user = await requireAdmin(req, res)
  if (!user) return
  const complaint = await store.findComplaint(req.params.id)
  if (!complaint) return fail(res, 404, 'NOT_FOUND', 'Aduan tidak ditemukan.')

  const { status } = req.body as { status: Complaint['status'] }
  if (!['baru', 'diproses', 'selesai'].includes(status)) {
    return fail(res, 400, 'INVALID', 'Status tidak dikenal.')
  }
  await store.setComplaintStatus(complaint.id, status)
  publish('complaint', complaint.id, 'status', { status }, user.id)
  res.json(await store.findComplaint(complaint.id))
})

/* ── Pembayaran ──────────────────────────────────────────────────────────── */

/**
 * Membuat tagihan.
 *
 * Klien menyebut **apa** yang mau dibayar; berapa besarnya dibaca dari
 * catatan. Menerima angka dari klien berarti menerima tagihan seratus rupiah
 * untuk lapangan dua ratus ribu.
 */
domainRoutes.post('/payments', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return

  const { kind, refId, method } = req.body as {
    kind: PaymentKind
    refId: string
    method: string
  }
  if (!['booking', 'merch', 'dues'].includes(kind) || !refId) {
    return fail(res, 422, 'INVALID_BODY', 'Jenis dan acuan pembayaran wajib diisi.')
  }

  const target = await chargeTargetFor(kind, refId, user)
  if ('error' in target) return fail(res, target.status, target.code, target.error)

  const account = await userForSession(bearer(req)!)
  const payment = await createCharge(
    {
      id: user.id,
      name: user.name,
      email: account?.email ?? null,
      phone: account?.phone ?? null,
    },
    target,
    method ?? 'qris',
  )
  res.status(201).json(payment)
})

type TargetOrError =
  | { kind: PaymentKind; refId: string; amountIdr: number; description: string }
  | { error: string; code: string; status: number }

/** Jumlah tagihan, selalu dibaca dari catatan yang tersimpan. */
async function chargeTargetFor(
  kind: PaymentKind,
  refId: string,
  user: DomainUser,
): Promise<TargetOrError> {
  if (kind === 'booking') {
    const booking = await store.getBooking(refId, user.id)
    if (!booking) return { error: 'Booking tidak ditemukan.', code: 'NOT_FOUND', status: 404 }
    if (booking.status === 'confirmed') {
      return { error: 'Booking ini sudah dibayar.', code: 'ALREADY_PAID', status: 409 }
    }
    if (booking.status !== 'awaitingPayment') {
      return { error: 'Booking ini sudah tidak bisa dibayar.', code: 'STALE_DRAFT', status: 409 }
    }
    return {
      kind,
      refId,
      amountIdr: booking.totalIdr,
      description: `${booking.venueName} · ${booking.courtName}`,
    }
  }

  if (kind === 'merch') {
    const found = await store.getMerchOrder(refId)
    if (!found || found.userId !== user.id) {
      return { error: 'Pesanan tidak ditemukan.', code: 'NOT_FOUND', status: 404 }
    }
    if (found.order.payMode === 'poin') {
      // Penebusan poin tidak melewati gerbang pembayaran: tidak ada uang yang
      // berpindah, dan poinnya sudah dipotong saat pesanan dibuat.
      return {
        error: 'Pesanan ini ditebus poin, bukan dibayar.',
        code: 'POINTS_ORDER',
        status: 409,
      }
    }
    if (found.order.status !== 'menunggu') {
      return { error: 'Pesanan ini sudah diproses.', code: 'ALREADY_PAID', status: 409 }
    }
    return {
      kind,
      refId,
      amountIdr: found.order.totalIdr,
      description: `${found.order.itemName} · ${found.order.variantLabel}`,
    }
  }

  const invoice = await store.findDuesInvoice(refId)
  if (!invoice || invoice.userId !== user.id) {
    return { error: 'Tagihan iuran tidak ditemukan.', code: 'NOT_FOUND', status: 404 }
  }
  if (invoice.status === 'lunas') {
    return { error: 'Tagihan ini sudah lunas.', code: 'ALREADY_PAID', status: 409 }
  }
  return {
    kind,
    refId,
    amountIdr: invoice.amountIdr,
    description: `Iuran keanggotaan ${invoice.period}`,
  }
}

domainRoutes.get('/payments', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  res.json(await listPayments(user.id))
})

domainRoutes.get('/payments/:id', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const row = await findPayment(req.params.id)
  if (!row || row.user_id !== user.id) {
    return fail(res, 404, 'NOT_FOUND', 'Pembayaran tidak ditemukan.')
  }
  res.json(paymentView(row))
})

/** Aliran status satu pembayaran — supaya layar tidak perlu polling. */
domainRoutes.get('/payments/:id/stream', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const row = await findPayment(req.params.id)
  if (!row || row.user_id !== user.id) {
    return fail(res, 404, 'NOT_FOUND', 'Pembayaran tidak ditemukan.')
  }
  openStream(res)
  const stopHeartbeat = heartbeat(res)
  const unsubscribe = subscribe('payment', row.id, user.id, res)
  req.on('close', () => {
    stopHeartbeat()
    unsubscribe()
  })
})

/**
 * Simulator: menandai sebuah tagihan lunas.
 *
 * Hanya ada saat penyedia sungguhan belum dikonfigurasi, dan jalurnya tetap
 * jalur produksi — ia merakit webhook bertanda tangan lalu mengirimkannya ke
 * endpoint yang sama. Dengan begitu verifikasi tanda tangan ikut terjalani
 * setiap hari, bukan jadi cabang kode yang baru pertama kali berjalan saat
 * rilis.
 */
domainRoutes.post('/payments/:id/simulate', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const provider = paymentProvider()
  if (!(provider instanceof SimulatorProvider)) {
    return fail(res, 404, 'NOT_FOUND', 'Simulator tidak aktif di server ini.')
  }

  const row = await findPayment(req.params.id)
  if (!row || row.user_id !== user.id) {
    return fail(res, 404, 'NOT_FOUND', 'Pembayaran tidak ditemukan.')
  }

  const status = (req.body as { status?: PaymentStatus }).status ?? 'settled'
  const body = JSON.stringify({
    paymentId: row.id,
    reference: row.provider_ref ?? row.id,
    status,
    amountIdr: Number(row.amount_idr),
    signature: provider.sign(row.id, status, Number(row.amount_idr)),
  })

  const event = provider.verifyWebhook(body, {})
  if (!event) return fail(res, 500, 'SIGN_FAILED', 'Simulator gagal menandatangani webhook.')

  const outcome = await applyWebhook(event)
  if (!outcome.ok) return fail(res, 409, outcome.reason.toUpperCase(), 'Pembayaran ditolak.')
  res.json(outcome.payment)
})

/* ── Iuran keanggotaan ───────────────────────────────────────────────────── */

domainRoutes.get('/dues', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  await store.ensureProfile(user)
  const settings = await store.getSettings()
  res.json({
    duesMonthlyIdr: settings.membership.duesMonthlyIdr,
    memberDiscount: settings.membership.memberDiscount,
    invoices: await store.listDuesInvoices(user.id),
  })
})

/**
 * Menerbitkan tagihan bulan berjalan.
 *
 * Idempoten lewat batasan unik `(user_id, period)`: menekan tombolnya dua
 * kali tidak menghasilkan dua tagihan, dan itu dijaga basis data — bukan
 * kehati-hatian pemanggil.
 */
domainRoutes.post('/dues/invoice', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  await store.ensureProfile(user)

  const settings = await store.getSettings()
  if (settings.membership.duesMonthlyIdr <= 0) {
    return fail(res, 409, 'NO_DUES', 'Klub ini belum menetapkan iuran keanggotaan.')
  }

  const invoice = await store.ensureDuesInvoice(
    user.id,
    (req.body as { period?: string }).period ?? currentPeriod(),
    settings.membership.duesMonthlyIdr,
  )
  res.status(201).json(invoice)
})

/** Periode berjalan dalam bentuk YYYY-MM. */
function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

/* ── Dasbor admin ────────────────────────────────────────────────────────── */

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
  if (memberDiscount < 0 || memberDiscount > 0.9) return 'Potongan anggota harus antara 0% dan 90%.'
  return null
}

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

export function validateMerchDraft(draft: MerchItemDraft): string | null {
  if (!draft.name.trim()) return 'Nama barang tidak boleh kosong.'
  if (draft.priceIdr === null && draft.pricePoints === null) {
    return 'Isi harga rupiah, harga poin, atau keduanya.'
  }
  if (draft.priceIdr !== null && draft.priceIdr < 1_000) return 'Harga rupiah minimal Rp1.000.'
  if (draft.pricePoints !== null && draft.pricePoints < 1) return 'Harga poin minimal 1 poin.'
  if (draft.variants.length === 0) return 'Tambahkan minimal satu varian atau ukuran.'
  const labels = draft.variants.map((v) => v.label.trim().toLowerCase())
  if (labels.some((l) => !l)) return 'Nama varian tidak boleh kosong.'
  if (new Set(labels).size !== labels.length) return 'Nama varian tidak boleh kembar.'
  if (draft.variants.some((v) => !Number.isInteger(v.stock) || v.stock < 0)) {
    return 'Stok harus bilangan bulat 0 atau lebih.'
  }
  return null
}

/** Pengaturan klub ikut menimpa venue miliknya sendiri. */
async function applySettingsToVenue(settings: ClubSettings): Promise<void> {
  const venue = await store.findVenue(settings.venueId)
  if (!venue) return
  await store.saveVenue({
    ...venue,
    name: settings.name,
    address: settings.address,
    district: settings.district,
    openHours: settings.openHours,
    pricePerHourIdr: settings.basePricePerHourIdr,
  })
}

domainRoutes.get('/admin/settings', async (req, res) => {
  const user = await requireAdmin(req, res)
  if (!user) return
  res.json(await store.getSettings())
})

domainRoutes.patch('/admin/settings', async (req, res) => {
  const user = await requireAdmin(req, res)
  if (!user) return
  const current = await store.getSettings()
  const next = { ...current, ...(req.body as Partial<ClubSettings>) } as ClubSettings
  const invalid = validateSettings(next)
  if (invalid) return fail(res, 400, 'INVALID', invalid)

  await store.saveSettings(next)
  await applySettingsToVenue(next)
  res.json(next)
})

domainRoutes.get('/admin/courts', async (req, res) => {
  const user = await requireAdmin(req, res)
  if (!user) return
  const settings = await store.getSettings()
  const venue = await store.findVenue(settings.venueId)
  res.json(venue?.courts ?? [])
})

domainRoutes.post('/admin/courts', async (req, res) => {
  const user = await requireAdmin(req, res)
  if (!user) return
  const settings = await store.getSettings()
  const venue = await store.findVenue(settings.venueId)
  if (!venue) return fail(res, 404, 'NOT_FOUND', 'Venue klub tidak ditemukan.')

  const draft = req.body as CourtDraft
  const invalid = validateCourt(draft, venue.courts)
  if (invalid) return fail(res, 400, 'INVALID', invalid)

  const court: Court = {
    id: `${venue.id}-c${venue.courts.length + 1}`,
    venueId: venue.id,
    name: draft.name.trim(),
    sport: draft.sport,
    indoor: draft.indoor,
    surface: draft.surface.trim(),
    ...(draft.pricePerHourIdr !== null ? { pricePerHourIdr: draft.pricePerHourIdr } : {}),
  }
  await store.saveVenue({ ...venue, courts: [...venue.courts, court] })
  res.status(201).json((await store.findVenue(venue.id))?.courts ?? [])
})

domainRoutes.patch('/admin/courts/:id', async (req, res) => {
  const user = await requireAdmin(req, res)
  if (!user) return
  const settings = await store.getSettings()
  const venue = await store.findVenue(settings.venueId)
  if (!venue) return fail(res, 404, 'NOT_FOUND', 'Venue klub tidak ditemukan.')

  const existing = venue.courts.find((c) => c.id === req.params.id)
  if (!existing) return fail(res, 404, 'NOT_FOUND', 'Lapangan tidak ditemukan.')

  const draft = req.body as CourtDraft
  const invalid = validateCourt(
    draft,
    venue.courts.filter((c) => c.id !== existing.id),
  )
  if (invalid) return fail(res, 400, 'INVALID', invalid)

  const updated: Court = {
    ...existing,
    name: draft.name.trim(),
    sport: draft.sport,
    indoor: draft.indoor,
    surface: draft.surface.trim(),
    ...(draft.pricePerHourIdr !== null
      ? { pricePerHourIdr: draft.pricePerHourIdr }
      : { pricePerHourIdr: undefined }),
  }
  await store.saveVenue({
    ...venue,
    courts: venue.courts.map((c) => (c.id === updated.id ? updated : c)),
  })
  res.json((await store.findVenue(venue.id))?.courts ?? [])
})

domainRoutes.delete('/admin/courts/:id', async (req, res) => {
  const user = await requireAdmin(req, res)
  if (!user) return
  const settings = await store.getSettings()
  const venue = await store.findVenue(settings.venueId)
  if (!venue) return fail(res, 404, 'NOT_FOUND', 'Venue klub tidak ditemukan.')
  if (venue.courts.length <= 1) {
    return fail(res, 409, 'LAST_COURT', 'Klub harus punya minimal satu lapangan.')
  }

  const upcoming = await store.countUpcomingBookings(req.params.id)
  if (upcoming > 0) {
    return fail(
      res,
      409,
      'HAS_BOOKINGS',
      `Masih ada ${upcoming} booking mendatang di lapangan ini.`,
    )
  }

  await store.saveVenue({ ...venue, courts: venue.courts.filter((c) => c.id !== req.params.id) })
  res.json((await store.findVenue(venue.id))?.courts ?? [])
})

domainRoutes.get('/admin/merch', async (req, res) => {
  const user = await requireAdmin(req, res)
  if (!user) return
  res.json(await store.listMerch({ includeInactive: true }))
})

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

domainRoutes.post('/admin/merch', async (req, res) => {
  const user = await requireAdmin(req, res)
  if (!user) return
  const draft = req.body as MerchItemDraft
  const invalid = validateMerchDraft(draft)
  if (invalid) return fail(res, 400, 'INVALID', invalid)

  await store.saveMerchItem(itemFromDraft(draft, store.uid('m')))
  res.status(201).json(await store.listMerch({ includeInactive: true }))
})

domainRoutes.patch('/admin/merch/:id', async (req, res) => {
  const user = await requireAdmin(req, res)
  if (!user) return
  const existing = await store.findMerchItem(req.params.id)
  if (!existing) return fail(res, 404, 'NOT_FOUND', 'Barang tidak ditemukan.')

  const draft = req.body as MerchItemDraft
  const invalid = validateMerchDraft(draft)
  if (invalid) return fail(res, 400, 'INVALID', invalid)

  // Foto dan id dipertahankan: mengubah harga tidak boleh mengganti gambar.
  await store.saveMerchItem({ ...itemFromDraft(draft, existing.id), photo: existing.photo })
  res.json(await store.listMerch({ includeInactive: true }))
})

domainRoutes.get('/admin/merch-orders', async (req, res) => {
  const user = await requireAdmin(req, res)
  if (!user) return
  res.json(await store.listAllMerchOrders())
})

domainRoutes.patch('/admin/merch-orders/:id', async (req, res) => {
  const user = await requireAdmin(req, res)
  if (!user) return

  const found = await store.getMerchOrder(req.params.id)
  if (!found) return fail(res, 404, 'NOT_FOUND', 'Pesanan tidak ditemukan.')

  const { status } = req.body as { status: MerchOrderStatus }
  if (!['menunggu', 'disiapkan', 'siapDiambil', 'selesai', 'batal'].includes(status)) {
    return fail(res, 400, 'INVALID', 'Status tidak dikenal.')
  }

  await store.saveMerchOrder(found.userId, { ...found.order, status })
  if (status === 'batal' && found.order.status !== 'batal') {
    await refundOrder(found.userId, found.order)
  }
  res.json(await store.listAllMerchOrders())
})

export type { AppNotification }
