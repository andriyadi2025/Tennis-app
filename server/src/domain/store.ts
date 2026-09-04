import { randomUUID } from 'node:crypto'
import type { Sql } from '../store/index.ts'
import { db } from '../db.ts'
import { migrateDomain } from './schema.ts'
import type {
  Booking,
  ChatMessage,
  ChatThread,
  ClubSettings,
  Complaint,
  ComplaintMessage,
  MerchItem,
  MerchOrder,
  OpenMatch,
  AppNotification,
  Review,
  SparringInvite,
  Team,
  TeamDraft,
  Tournament,
  TournamentRegistration,
  User,
  Venue,
} from '../../../shared/types.ts'
import {
  CHATS,
  CLUB_SETTINGS,
  COMPLAINTS,
  MERCH_ITEMS,
  NOTIFICATIONS,
  OPEN_MATCHES,
  REVIEWS,
  SPARRING,
  TEAMS,
  TOURNAMENTS,
  VENUES,
} from '../../../shared/seed.ts'
import { tierFor } from '../../../shared/points.ts'

/**
 * Akses data domain.
 *
 * Perbedaan terbesar dari server tiruan yang digantikannya: **semuanya milik
 * seseorang**. Booking, poin, pesanan, dan aduan disimpan dengan `user_id`
 * dari sesi, bukan diambil dari satu profil global. Itulah yang selama ini
 * disembunyikan MSW — di browser hanya ada satu orang, jadi kepemilikan tidak
 * pernah diuji.
 */

const now = () => new Date().toISOString()
const uid = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`

/* ── JSON di kolom TEXT ──────────────────────────────────────────────────── */

function pack(value: unknown): string {
  return JSON.stringify(value)
}

/**
 * Membaca kolom JSON. SQLite mengembalikannya sebagai string; Postgres juga,
 * karena kolomnya memang TEXT dan bukan jsonb — dipilih begitu supaya
 * bentuknya sama di kedua mesin dan tidak ada driver yang diam-diam
 * mem-parse lebih dulu.
 */
function unpack<T>(raw: unknown): T {
  return typeof raw === 'string' ? (JSON.parse(raw) as T) : (raw as T)
}

/* ── Penyemaian ──────────────────────────────────────────────────────────── */

/**
 * Data referensi diisi sekali, kalau tabelnya masih kosong.
 *
 * Diperiksa lewat isi tabel, bukan lewat penanda terpisah: penanda bisa
 * benar sementara tabelnya sudah dikosongkan orang, dan penyemaian yang
 * mengira dirinya sudah jalan akan meninggalkan app tanpa satu pun venue.
 */
export async function seedDomain(sql: Sql = db): Promise<void> {
  await migrateDomain(sql)

  const counted = await sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM venues')
  if (Number(counted?.n ?? 0) > 0) return

  await sql.transaction(async (tx) => {
    for (const venue of VENUES) {
      await tx.run('INSERT INTO venues (id, data) VALUES (?, ?)', [venue.id, pack(venue)])
    }

    await tx.run('INSERT INTO club_settings (id, data) VALUES (1, ?)', [pack(CLUB_SETTINGS)])

    for (const review of REVIEWS) {
      await tx.run(
        `INSERT INTO reviews (id, venue_id, author_id, author_name, rating, body, tags, created_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
        [
          review.id,
          review.venueId,
          review.authorName,
          review.rating,
          review.body,
          pack(review.tags),
          review.createdAt,
        ],
      )
    }

    for (const match of OPEN_MATCHES) {
      await tx.run('INSERT INTO open_matches (id, starts_at, sport, data) VALUES (?, ?, ?, ?)', [
        match.id,
        match.startsAt,
        match.sport,
        pack({ ...match, players: [] }),
      ])
      for (const player of match.players) {
        await tx.run(
          'INSERT INTO open_match_players (match_id, user_id, name, level) VALUES (?, ?, ?, ?)',
          [match.id, player.id, player.name, player.level],
        )
      }
    }

    for (const team of TEAMS) {
      // Tim bawaan tidak punya pemilik akun di sini.
      await tx.run('INSERT INTO teams (id, sport, owner_id, data) VALUES (?, ?, NULL, ?)', [
        team.id,
        team.sport,
        pack({ ...team, members: [], ownerId: null }),
      ])
      for (const member of team.members) {
        await tx.run(
          'INSERT INTO team_members (team_id, user_id, name, level) VALUES (?, ?, ?, ?)',
          [team.id, member.id, member.name, member.level],
        )
      }
    }

    for (const tournament of TOURNAMENTS) {
      await tx.run(
        'INSERT INTO tournaments (id, starts_at, status, slots_taken, data) VALUES (?, ?, ?, ?, ?)',
        [
          tournament.id,
          tournament.startsAt,
          tournament.status,
          tournament.slotsTaken,
          pack(tournament),
        ],
      )
    }

    for (const chat of CHATS) {
      await tx.run('INSERT INTO chats (id, title, subtitle, booking_id) VALUES (?, ?, ?, ?)', [
        chat.id,
        chat.title,
        chat.subtitle,
        chat.bookingId,
      ])
      for (const message of chat.messages) {
        await tx.run(
          `INSERT INTO chat_messages (id, chat_id, author_id, author_name, body, sent_at, split_card_booking_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            message.id,
            chat.id,
            message.authorId,
            message.authorName,
            message.body,
            message.sentAt,
            message.splitCardBookingId ?? null,
          ],
        )
      }
    }

    for (const invite of SPARRING) {
      await tx.run(
        `INSERT INTO sparring (id, from_team_id, from_team_name, to_team_id, to_team_name, sport, proposed_at, venue_name, message, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invite.id,
          invite.fromTeamId,
          invite.fromTeamName,
          invite.toTeamId,
          invite.toTeamName,
          invite.sport,
          invite.proposedAt,
          invite.venueName,
          invite.message,
          invite.status,
          invite.createdAt,
        ],
      )
    }

    for (const item of MERCH_ITEMS) {
      await tx.run('INSERT INTO merch_items (id, category, active, data) VALUES (?, ?, ?, ?)', [
        item.id,
        item.category,
        item.active ? 1 : 0,
        pack(item),
      ])
    }

    /*
     * Notifikasi dan aduan contoh sengaja **tidak** disemai di sini.
     * Keduanya milik seseorang, dan pada saat penyemaian belum ada satu pun
     * user — memberikannya ke id karangan berarti tidak akan pernah terlihat
     * siapa pun. Keduanya dibuatkan saat profil pertama kali dibuka.
     */
  })
}

/* ── Profil ──────────────────────────────────────────────────────────────── */

interface ProfileRow {
  user_id: string
  points: number
  tier: string
  favourite_sport: string
  is_member: number
  joined_at: string
}

export interface DomainUser {
  id: string
  name: string
  role: 'member' | 'admin'
}

/**
 * Profil main, dibuat saat pertama dibutuhkan.
 *
 * Membuatnya saat pendaftaran akan berarti server auth tahu soal poin, dan
 * dua hal yang sengaja dipisah jadi saling tahu lagi. Dibuat di sini, saat
 * pertama kali ada yang menanyakannya.
 */
export async function ensureProfile(user: DomainUser, sql: Sql = db): Promise<User> {
  const existing = await sql.get<ProfileRow>('SELECT * FROM profiles WHERE user_id = ?', [user.id])
  if (!existing) {
    await sql.run(
      `INSERT INTO profiles (user_id, points, tier, favourite_sport, is_member, joined_at)
       VALUES (?, 0, 'Rookie', 'tennis', 0, ?)`,
      [user.id, now()],
    )
    await seedNotificationsFor(user.id, sql)
    await seedComplaintFor(user, sql)
    return ensureProfile(user, sql)
  }

  return {
    id: user.id,
    name: user.name,
    // Nomor dan email tinggal di server auth; profil main tidak menyalinnya
    // supaya tidak ada dua versi yang bisa berbeda.
    phone: '',
    email: '',
    points: Number(existing.points),
    tier: existing.tier as User['tier'],
    joinedAt: existing.joined_at,
    favouriteSport: existing.favourite_sport as User['favouriteSport'],
    matchesPlayed: 0,
    role: user.role,
    isMember: existing.is_member === 1,
  }
}

export async function addPoints(
  userId: string,
  delta: number,
  sql: Sql = db,
): Promise<User['points']> {
  const row = await sql.get<{ points: number }>('SELECT points FROM profiles WHERE user_id = ?', [
    userId,
  ])
  const next = Math.max(0, Number(row?.points ?? 0) + Math.round(delta))
  await sql.run('UPDATE profiles SET points = ?, tier = ? WHERE user_id = ?', [
    next,
    tierFor(next),
    userId,
  ])
  return next
}

export async function setMembership(userId: string, isMember: boolean, sql: Sql = db) {
  await sql.run('UPDATE profiles SET is_member = ? WHERE user_id = ?', [isMember ? 1 : 0, userId])
}

/* ── Notifikasi & aduan contoh untuk user baru ───────────────────────────── */

async function seedNotificationsFor(userId: string, sql: Sql): Promise<void> {
  for (const n of NOTIFICATIONS) {
    await sql.run(
      `INSERT INTO notifications (id, user_id, kind, title, body, href, read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `${n.id}-${userId.slice(-6)}`,
        userId,
        n.kind,
        n.title,
        n.body,
        n.href,
        n.read ? 1 : 0,
        n.createdAt,
      ],
    )
  }
}

async function seedComplaintFor(user: DomainUser, sql: Sql): Promise<void> {
  for (const c of COMPLAINTS) {
    const id = `${c.id}-${user.id.slice(-6)}`
    await sql.run(
      `INSERT INTO complaints (id, code, user_id, user_name, category, subject, status, related_kind, related_id, related_label, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
      [id, c.code, user.id, user.name, c.category, c.subject, c.status, c.createdAt, c.updatedAt],
    )
    for (const m of c.messages) {
      await sql.run(
        `INSERT INTO complaint_messages (id, complaint_id, author_role, author_name, body, sent_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          `${m.id}-${user.id.slice(-6)}`,
          id,
          m.authorRole,
          m.authorRole === 'admin' ? m.authorName : user.name,
          m.body,
          m.sentAt,
        ],
      )
    }
  }
}

/* ── Venue, lapangan, pengaturan ─────────────────────────────────────────── */

export async function listVenues(sql: Sql = db): Promise<Venue[]> {
  const rows = await sql.all<{ data: string }>('SELECT data FROM venues')
  return rows.map((r) => unpack<Venue>(r.data))
}

export async function findVenue(id: string, sql: Sql = db): Promise<Venue | undefined> {
  const row = await sql.get<{ data: string }>('SELECT data FROM venues WHERE id = ?', [id])
  return row ? unpack<Venue>(row.data) : undefined
}

export async function saveVenue(venue: Venue, sql: Sql = db): Promise<void> {
  await sql.run('UPDATE venues SET data = ? WHERE id = ?', [pack(venue), venue.id])
}

export async function getSettings(sql: Sql = db): Promise<ClubSettings> {
  const row = await sql.get<{ data: string }>('SELECT data FROM club_settings WHERE id = 1')
  return unpack<ClubSettings>(row!.data)
}

export async function saveSettings(settings: ClubSettings, sql: Sql = db): Promise<void> {
  await sql.run('UPDATE club_settings SET data = ? WHERE id = 1', [pack(settings)])
}

/* ── Ulasan ──────────────────────────────────────────────────────────────── */

interface ReviewRow {
  id: string
  venue_id: string
  author_name: string
  rating: number
  body: string
  tags: string
  created_at: string
}

const toReview = (r: ReviewRow): Review => ({
  id: r.id,
  venueId: r.venue_id,
  authorName: r.author_name,
  rating: Number(r.rating),
  body: r.body,
  tags: unpack<string[]>(r.tags),
  createdAt: r.created_at,
})

export async function listReviews(venueId: string, sql: Sql = db): Promise<Review[]> {
  const rows = await sql.all<ReviewRow>(
    'SELECT * FROM reviews WHERE venue_id = ? ORDER BY created_at DESC',
    [venueId],
  )
  return rows.map(toReview)
}

export async function addReview(
  venueId: string,
  author: DomainUser,
  rating: number,
  body: string,
  sql: Sql = db,
): Promise<Review> {
  const review: Review = {
    id: uid('rev'),
    venueId,
    authorName: author.name,
    rating,
    body,
    tags: [],
    createdAt: now(),
  }
  await sql.run(
    `INSERT INTO reviews (id, venue_id, author_id, author_name, rating, body, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [review.id, venueId, author.id, author.name, rating, body, pack([]), review.createdAt],
  )
  return review
}

/**
 * Rating venue dihitung ulang dari ulasan yang benar-benar ada, supaya angka
 * di kartu venue tidak bertentangan dengan daftar ulasannya sendiri.
 */
export async function recomputeVenueRating(venueId: string, sql: Sql = db): Promise<void> {
  const venue = await findVenue(venueId, sql)
  if (!venue) return
  const rows = await sql.all<{ rating: number }>('SELECT rating FROM reviews WHERE venue_id = ?', [
    venueId,
  ])
  if (rows.length === 0) return
  const average = rows.reduce((sum, r) => sum + Number(r.rating), 0) / rows.length
  await saveVenue(
    { ...venue, rating: Math.round(average * 10) / 10, reviewCount: rows.length },
    sql,
  )
}

/* ── Slot ────────────────────────────────────────────────────────────────── */

export async function takenSlots(courtId: string, sql: Sql = db): Promise<Set<string>> {
  const rows = await sql.all<{ starts_at: string }>(
    'SELECT starts_at FROM taken_slots WHERE court_id = ?',
    [courtId],
  )
  return new Set(rows.map((r) => r.starts_at))
}

export async function claimSlots(
  courtId: string,
  startsAt: readonly string[],
  bookingId: string,
  sql: Sql = db,
): Promise<void> {
  for (const iso of startsAt) {
    await sql.run(
      `INSERT INTO taken_slots (court_id, starts_at, booking_id) VALUES (?, ?, ?)
       ON CONFLICT (court_id, starts_at) DO NOTHING`,
      [courtId, iso, bookingId],
    )
  }
}

export async function isSlotTaken(courtId: string, iso: string, sql: Sql = db): Promise<boolean> {
  const row = await sql.get('SELECT 1 AS x FROM taken_slots WHERE court_id = ? AND starts_at = ?', [
    courtId,
    iso,
  ])
  return Boolean(row)
}

/* ── Booking ─────────────────────────────────────────────────────────────── */

interface BookingRow {
  id: string
  user_id: string
  venue_id: string
  venue_name: string
  court_id: string
  court_name: string
  sport: string
  starts_at: string
  ends_at: string
  hours: number
  recurrence: string | null
  purpose: string
  add_ons: string
  split_bill: string | null
  status: string
  payment_method: string | null
  code: string
  subtotal_idr: number
  points_redeemed: number
  discount_idr: number
  service_fee_idr: number
  total_idr: number
  payment_deadline: string | null
  created_at: string
}

function toBooking(r: BookingRow): Booking {
  return {
    id: r.id,
    venueId: r.venue_id,
    venueName: r.venue_name,
    courtId: r.court_id,
    courtName: r.court_name,
    sport: r.sport as Booking['sport'],
    range: { startsAt: r.starts_at, endsAt: r.ends_at, hours: Number(r.hours) },
    recurrence: r.recurrence ? unpack<Booking['recurrence']>(r.recurrence) : null,
    purpose: r.purpose as Booking['purpose'],
    addOns: unpack<Booking['addOns']>(r.add_ons),
    splitBill: r.split_bill ? unpack<Booking['splitBill']>(r.split_bill) : null,
    status: r.status as Booking['status'],
    paymentMethod: r.payment_method as Booking['paymentMethod'],
    code: r.code,
    subtotalIdr: Number(r.subtotal_idr),
    pointsRedeemed: Number(r.points_redeemed),
    discountIdr: Number(r.discount_idr),
    serviceFeeIdr: Number(r.service_fee_idr),
    totalIdr: Number(r.total_idr),
    createdAt: r.created_at,
    paymentDeadline: r.payment_deadline,
  }
}

export async function saveBooking(userId: string, b: Booking, sql: Sql = db): Promise<void> {
  await sql.run(
    `INSERT INTO bookings (id, user_id, venue_id, venue_name, court_id, court_name, sport,
       starts_at, ends_at, hours, recurrence, purpose, add_ons, split_bill, status,
       payment_method, code, subtotal_idr, points_redeemed, discount_idr, service_fee_idr,
       total_idr, payment_deadline, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       split_bill = excluded.split_bill,
       status = excluded.status,
       payment_method = excluded.payment_method,
       points_redeemed = excluded.points_redeemed,
       discount_idr = excluded.discount_idr,
       total_idr = excluded.total_idr,
       payment_deadline = excluded.payment_deadline`,
    [
      b.id,
      userId,
      b.venueId,
      b.venueName,
      b.courtId,
      b.courtName,
      b.sport,
      b.range.startsAt,
      b.range.endsAt,
      b.range.hours,
      b.recurrence ? pack(b.recurrence) : null,
      b.purpose,
      pack(b.addOns),
      b.splitBill ? pack(b.splitBill) : null,
      b.status,
      b.paymentMethod,
      b.code,
      b.subtotalIdr,
      b.pointsRedeemed,
      b.discountIdr,
      b.serviceFeeIdr,
      b.totalIdr,
      b.paymentDeadline,
      b.createdAt,
    ],
  )
}

export async function listBookings(userId: string, sql: Sql = db): Promise<Booking[]> {
  const rows = await sql.all<BookingRow>(
    'SELECT * FROM bookings WHERE user_id = ? ORDER BY starts_at DESC',
    [userId],
  )
  return rows.map(toBooking)
}

export async function getBooking(
  id: string,
  userId: string,
  sql: Sql = db,
): Promise<Booking | undefined> {
  const row = await sql.get<BookingRow>('SELECT * FROM bookings WHERE id = ? AND user_id = ?', [
    id,
    userId,
  ])
  return row ? toBooking(row) : undefined
}

/* ── Open match ──────────────────────────────────────────────────────────── */

export async function listOpenMatches(sql: Sql = db): Promise<OpenMatch[]> {
  const rows = await sql.all<{ id: string; data: string }>(
    'SELECT id, data FROM open_matches ORDER BY starts_at ASC',
  )
  const out: OpenMatch[] = []
  for (const row of rows) {
    out.push({ ...unpack<OpenMatch>(row.data), players: await matchPlayers(row.id, sql) })
  }
  return out
}

async function matchPlayers(matchId: string, sql: Sql): Promise<OpenMatch['players']> {
  const rows = await sql.all<{ user_id: string; name: string; level: string }>(
    'SELECT user_id, name, level FROM open_match_players WHERE match_id = ?',
    [matchId],
  )
  return rows.map((r) => ({ id: r.user_id, name: r.name, level: r.level as 'pemula' }))
}

export async function findOpenMatch(id: string, sql: Sql = db): Promise<OpenMatch | undefined> {
  const row = await sql.get<{ data: string }>('SELECT data FROM open_matches WHERE id = ?', [id])
  if (!row) return undefined
  return { ...unpack<OpenMatch>(row.data), players: await matchPlayers(id, sql) }
}

export async function joinMatch(matchId: string, user: DomainUser, sql: Sql = db): Promise<void> {
  await sql.run(
    `INSERT INTO open_match_players (match_id, user_id, name, level) VALUES (?, ?, ?, 'menengah')
     ON CONFLICT (match_id, user_id) DO NOTHING`,
    [matchId, user.id, user.name],
  )
}

export async function leaveMatch(matchId: string, userId: string, sql: Sql = db): Promise<void> {
  await sql.run('DELETE FROM open_match_players WHERE match_id = ? AND user_id = ?', [
    matchId,
    userId,
  ])
}

/* ── Tim ─────────────────────────────────────────────────────────────────── */

export async function listTeams(sql: Sql = db): Promise<Team[]> {
  const rows = await sql.all<{ id: string; data: string; owner_id: string | null }>(
    'SELECT id, data, owner_id FROM teams',
  )
  const out: Team[] = []
  for (const row of rows) {
    const members = await sql.all<{ user_id: string; name: string; level: string }>(
      'SELECT user_id, name, level FROM team_members WHERE team_id = ?',
      [row.id],
    )
    const team = unpack<Team>(row.data)
    out.push({
      ...team,
      ownerId: row.owner_id,
      members: members.map((m) => ({ id: m.user_id, name: m.name, level: m.level as 'pemula' })),
      memberCount: members.length,
    })
  }
  return out
}

export async function findTeam(id: string, sql: Sql = db): Promise<Team | undefined> {
  return (await listTeams(sql)).find((t) => t.id === id)
}

export async function joinTeam(teamId: string, user: DomainUser, sql: Sql = db): Promise<void> {
  await sql.run(
    `INSERT INTO team_members (team_id, user_id, name, level) VALUES (?, ?, ?, 'menengah')
     ON CONFLICT (team_id, user_id) DO NOTHING`,
    [teamId, user.id, user.name],
  )
}

/**
 * Membuat tim, lalu langsung memasukkan pembuatnya sebagai anggota.
 *
 * Tim tanpa satu pun anggota tidak bisa mengajak siapa pun sparring, dan
 * membiarkan pembuatnya di luar berarti langkah pertama setiap orang adalah
 * bergabung ke tim yang baru saja ia buat sendiri.
 */
export async function createTeam(
  draft: TeamDraft,
  owner: DomainUser,
  sql: Sql = db,
): Promise<Team> {
  const id = uid('t')
  const seed = id.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
  const tones = ['accent', 'accent2', 'neutral'] as const
  const team: Team = {
    id,
    name: draft.name.trim(),
    sport: draft.sport,
    city: draft.city.trim(),
    memberCount: 1,
    members: [],
    wins: 0,
    losses: 0,
    photo: { tone: tones[seed % 3] ?? 'accent', step: 300, seed },
    about: draft.about.trim(),
    ownerId: owner.id,
  }

  await sql.transaction(async (tx) => {
    await tx.run('INSERT INTO teams (id, sport, owner_id, data) VALUES (?, ?, ?, ?)', [
      id,
      team.sport,
      owner.id,
      pack({ ...team, members: [] }),
    ])
    await tx.run(
      "INSERT INTO team_members (team_id, user_id, name, level) VALUES (?, ?, ?, 'menengah')",
      [id, owner.id, owner.name],
    )
  })

  return (await findTeam(id, sql))!
}

export async function updateTeam(
  id: string,
  draft: TeamDraft,
  sql: Sql = db,
): Promise<Team | undefined> {
  const existing = await findTeam(id, sql)
  if (!existing) return undefined
  const next: Team = {
    ...existing,
    name: draft.name.trim(),
    sport: draft.sport,
    city: draft.city.trim(),
    about: draft.about.trim(),
  }
  await sql.run('UPDATE teams SET sport = ?, data = ? WHERE id = ?', [
    next.sport,
    pack({ ...next, members: [] }),
    id,
  ])
  return findTeam(id, sql)
}

export async function leaveTeam(teamId: string, userId: string, sql: Sql = db): Promise<void> {
  await sql.run('DELETE FROM team_members WHERE team_id = ? AND user_id = ?', [teamId, userId])
}

/** Id tim yang diikuti user — dasar semua tampilan sparring. */
export async function myTeamIds(userId: string, sql: Sql = db): Promise<Set<string>> {
  return new Set(await teamsJoinedBy(userId, sql))
}

export async function teamsJoinedBy(userId: string, sql: Sql = db): Promise<string[]> {
  const rows = await sql.all<{ team_id: string }>(
    'SELECT team_id FROM team_members WHERE user_id = ?',
    [userId],
  )
  return rows.map((r) => r.team_id)
}

export async function matchesJoinedBy(userId: string, sql: Sql = db): Promise<string[]> {
  const rows = await sql.all<{ match_id: string }>(
    'SELECT match_id FROM open_match_players WHERE user_id = ?',
    [userId],
  )
  return rows.map((r) => r.match_id)
}

/* ── Turnamen ────────────────────────────────────────────────────────────── */

export async function listTournaments(sql: Sql = db): Promise<Tournament[]> {
  const rows = await sql.all<{ data: string; slots_taken: number }>(
    'SELECT data, slots_taken FROM tournaments ORDER BY starts_at ASC',
  )
  return rows.map((r) => ({ ...unpack<Tournament>(r.data), slotsTaken: Number(r.slots_taken) }))
}

export async function findTournament(id: string, sql: Sql = db): Promise<Tournament | undefined> {
  const row = await sql.get<{ data: string; slots_taken: number }>(
    'SELECT data, slots_taken FROM tournaments WHERE id = ?',
    [id],
  )
  return row ? { ...unpack<Tournament>(row.data), slotsTaken: Number(row.slots_taken) } : undefined
}

export async function bumpTournamentSlots(id: string, sql: Sql = db): Promise<void> {
  await sql.run('UPDATE tournaments SET slots_taken = slots_taken + 1 WHERE id = ?', [id])
}

interface RegistrationRow {
  id: string
  tournament_id: string
  tournament_name: string
  entry_fee_idr: number
  payment_method: string
  payment_status: string
  code: string
  registered_at: string
}

const toRegistration = (r: RegistrationRow): TournamentRegistration => ({
  id: r.id,
  tournamentId: r.tournament_id,
  tournamentName: r.tournament_name,
  entryFeeIdr: Number(r.entry_fee_idr),
  paymentMethod: r.payment_method as TournamentRegistration['paymentMethod'],
  paymentStatus: r.payment_status as TournamentRegistration['paymentStatus'],
  code: r.code,
  registeredAt: r.registered_at,
})

export async function listRegistrations(
  userId: string,
  sql: Sql = db,
): Promise<TournamentRegistration[]> {
  const rows = await sql.all<RegistrationRow>(
    'SELECT * FROM registrations WHERE user_id = ? ORDER BY registered_at DESC',
    [userId],
  )
  return rows.map(toRegistration)
}

export async function saveRegistration(
  userId: string,
  registration: TournamentRegistration,
  sql: Sql = db,
): Promise<void> {
  await sql.run(
    `INSERT INTO registrations (id, user_id, tournament_id, tournament_name, entry_fee_idr, payment_method, payment_status, code, registered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      registration.id,
      userId,
      registration.tournamentId,
      registration.tournamentName,
      registration.entryFeeIdr,
      registration.paymentMethod,
      registration.paymentStatus,
      registration.code,
      registration.registeredAt,
    ],
  )
}

export async function hasRegistered(
  userId: string,
  tournamentId: string,
  sql: Sql = db,
): Promise<boolean> {
  const row = await sql.get(
    'SELECT 1 AS x FROM registrations WHERE user_id = ? AND tournament_id = ?',
    [userId, tournamentId],
  )
  return Boolean(row)
}

/* ── Obrolan ─────────────────────────────────────────────────────────────── */

interface MessageRow {
  id: string
  chat_id: string
  author_id: string
  author_name: string
  body: string
  sent_at: string
  split_card_booking_id: string | null
}

const toMessage = (r: MessageRow): ChatMessage => ({
  id: r.id,
  chatId: r.chat_id,
  authorId: r.author_id,
  authorName: r.author_name,
  body: r.body,
  sentAt: r.sent_at,
  ...(r.split_card_booking_id ? { splitCardBookingId: r.split_card_booking_id } : {}),
})

export async function findChat(id: string, sql: Sql = db): Promise<ChatThread | undefined> {
  const chat = await sql.get<{
    id: string
    title: string
    subtitle: string
    booking_id: string | null
  }>('SELECT * FROM chats WHERE id = ?', [id])
  if (!chat) return undefined
  const rows = await sql.all<MessageRow>(
    'SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY sent_at ASC',
    [id],
  )
  return {
    id: chat.id,
    title: chat.title,
    subtitle: chat.subtitle,
    bookingId: chat.booking_id,
    messages: rows.map(toMessage),
  }
}

export async function addChatMessage(
  chatId: string,
  author: DomainUser,
  body: string,
  sql: Sql = db,
): Promise<ChatMessage> {
  const message: ChatMessage = {
    id: uid('msg'),
    chatId,
    authorId: author.id,
    authorName: author.name,
    body,
    sentAt: now(),
  }
  await sql.run(
    `INSERT INTO chat_messages (id, chat_id, author_id, author_name, body, sent_at, split_card_booking_id)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    [message.id, chatId, author.id, author.name, body, message.sentAt],
  )
  return message
}

/* ── Notifikasi ──────────────────────────────────────────────────────────── */

interface NotificationRow {
  id: string
  kind: string
  title: string
  body: string
  href: string | null
  read: number
  created_at: string
}

const toNotification = (r: NotificationRow): AppNotification => ({
  id: r.id,
  kind: r.kind as AppNotification['kind'],
  title: r.title,
  body: r.body,
  href: r.href,
  read: Number(r.read) === 1,
  createdAt: r.created_at,
})

export async function listNotifications(userId: string, sql: Sql = db): Promise<AppNotification[]> {
  const rows = await sql.all<NotificationRow>(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC',
    [userId],
  )
  return rows.map(toNotification)
}

export async function markNotificationRead(
  id: string,
  userId: string,
  sql: Sql = db,
): Promise<AppNotification | undefined> {
  await sql.run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', [id, userId])
  const row = await sql.get<NotificationRow>(
    'SELECT * FROM notifications WHERE id = ? AND user_id = ?',
    [id, userId],
  )
  return row ? toNotification(row) : undefined
}

export async function markAllNotificationsRead(userId: string, sql: Sql = db): Promise<void> {
  await sql.run('UPDATE notifications SET read = 1 WHERE user_id = ?', [userId])
}

export async function pushNotification(
  userId: string,
  n: Omit<AppNotification, 'id' | 'createdAt' | 'read'>,
  sql: Sql = db,
): Promise<AppNotification> {
  const row: AppNotification = { ...n, id: uid('ntf'), read: false, createdAt: now() }
  await sql.run(
    `INSERT INTO notifications (id, user_id, kind, title, body, href, read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    [row.id, userId, row.kind, row.title, row.body, row.href, row.createdAt],
  )
  return row
}

/* ── Sparring ────────────────────────────────────────────────────────────── */

interface SparringRow {
  id: string
  from_team_id: string
  from_team_name: string
  to_team_id: string
  to_team_name: string
  sport: string
  proposed_at: string | null
  venue_name: string | null
  message: string
  status: string
  created_at: string
}

/**
 * Arah ajakan dilihat dari tim-tim yang benar-benar diikuti user.
 *
 * Dulu dibandingkan dengan satu id tim yang ditanam di kode, jadi setiap
 * ajakan yang tidak menuju tim itu tampak sebagai "keluar" — termasuk yang
 * bukan urusan user sama sekali.
 */
const toSparring = (r: SparringRow, myTeamIds: ReadonlySet<string>): SparringInvite => ({
  id: r.id,
  direction: myTeamIds.has(r.to_team_id) ? 'masuk' : 'keluar',
  fromTeamId: r.from_team_id,
  fromTeamName: r.from_team_name,
  toTeamId: r.to_team_id,
  toTeamName: r.to_team_name,
  sport: r.sport as SparringInvite['sport'],
  proposedAt: r.proposed_at,
  venueName: r.venue_name,
  message: r.message,
  status: r.status as SparringInvite['status'],
  createdAt: r.created_at,
})

/**
 * Ajakan yang melibatkan salah satu tim user — bukan seluruh ajakan yang ada.
 * Sebelumnya semua baris dikembalikan apa adanya, jadi tiap orang melihat
 * tawar-menawar tim lain.
 */
export async function listSparring(
  myTeamIds: ReadonlySet<string>,
  sql: Sql = db,
): Promise<SparringInvite[]> {
  if (myTeamIds.size === 0) return []
  const rows = await sql.all<SparringRow>('SELECT * FROM sparring ORDER BY created_at DESC')
  return rows
    .filter((r) => myTeamIds.has(r.from_team_id) || myTeamIds.has(r.to_team_id))
    .map((r) => toSparring(r, myTeamIds))
}

export async function findSparring(id: string, myTeamIds: ReadonlySet<string>, sql: Sql = db) {
  const row = await sql.get<SparringRow>('SELECT * FROM sparring WHERE id = ?', [id])
  if (!row) return undefined
  // Ajakan yang tidak melibatkan tim user bukan miliknya untuk dibaca.
  if (!myTeamIds.has(row.from_team_id) && !myTeamIds.has(row.to_team_id)) return undefined
  return toSparring(row, myTeamIds)
}

export async function saveSparring(invite: SparringInvite, sql: Sql = db): Promise<void> {
  await sql.run(
    `INSERT INTO sparring (id, from_team_id, from_team_name, to_team_id, to_team_name, sport, proposed_at, venue_name, message, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       proposed_at = excluded.proposed_at,
       venue_name = excluded.venue_name,
       status = excluded.status`,
    [
      invite.id,
      invite.fromTeamId,
      invite.fromTeamName,
      invite.toTeamId,
      invite.toTeamName,
      invite.sport,
      invite.proposedAt,
      invite.venueName,
      invite.message,
      invite.status,
      invite.createdAt,
    ],
  )
}

export async function setSparringStatus(
  id: string,
  status: SparringInvite['status'],
  sql: Sql = db,
): Promise<void> {
  await sql.run('UPDATE sparring SET status = ? WHERE id = ?', [status, id])
}

/* ── Toko ────────────────────────────────────────────────────────────────── */

export async function listMerch(
  options: { includeInactive?: boolean; category?: string | null } = {},
  sql: Sql = db,
): Promise<MerchItem[]> {
  const rows = await sql.all<{ data: string }>('SELECT data FROM merch_items')
  return rows
    .map((r) => unpack<MerchItem>(r.data))
    .filter((m) => (options.includeInactive ? true : m.active))
    .filter((m) => (options.category ? m.category === options.category : true))
}

export async function findMerchItem(id: string, sql: Sql = db): Promise<MerchItem | undefined> {
  const row = await sql.get<{ data: string }>('SELECT data FROM merch_items WHERE id = ?', [id])
  return row ? unpack<MerchItem>(row.data) : undefined
}

export async function saveMerchItem(item: MerchItem, sql: Sql = db): Promise<void> {
  await sql.run(
    `INSERT INTO merch_items (id, category, active, data) VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET category = excluded.category, active = excluded.active, data = excluded.data`,
    [item.id, item.category, item.active ? 1 : 0, pack(item)],
  )
}

interface OrderRow {
  id: string
  item_id: string
  item_name: string
  variant_id: string
  variant_label: string
  qty: number
  pay_mode: string
  payment_method: string | null
  total_idr: number
  points_spent: number
  points_earned: number
  status: string
  code: string
  created_at: string
}

const toOrder = (r: OrderRow): MerchOrder => ({
  id: r.id,
  code: r.code,
  itemId: r.item_id,
  itemName: r.item_name,
  variantId: r.variant_id,
  variantLabel: r.variant_label,
  qty: Number(r.qty),
  payMode: r.pay_mode as MerchOrder['payMode'],
  paymentMethod: r.payment_method as MerchOrder['paymentMethod'],
  totalIdr: Number(r.total_idr),
  pointsSpent: Number(r.points_spent),
  pointsEarned: Number(r.points_earned),
  status: r.status as MerchOrder['status'],
  createdAt: r.created_at,
})

export async function saveMerchOrder(
  userId: string,
  order: MerchOrder,
  sql: Sql = db,
): Promise<void> {
  await sql.run(
    `INSERT INTO merch_orders (id, user_id, item_id, item_name, variant_id, variant_label, qty, pay_mode, payment_method, total_idr, points_spent, points_earned, status, code, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET status = excluded.status`,
    [
      order.id,
      userId,
      order.itemId,
      order.itemName,
      order.variantId,
      order.variantLabel,
      order.qty,
      order.payMode,
      order.paymentMethod,
      order.totalIdr,
      order.pointsSpent,
      order.pointsEarned,
      order.status,
      order.code,
      order.createdAt,
    ],
  )
}

export async function listMerchOrders(userId: string, sql: Sql = db): Promise<MerchOrder[]> {
  const rows = await sql.all<OrderRow>(
    'SELECT * FROM merch_orders WHERE user_id = ? ORDER BY created_at DESC',
    [userId],
  )
  return rows.map(toOrder)
}

export async function listAllMerchOrders(sql: Sql = db): Promise<MerchOrder[]> {
  const rows = await sql.all<OrderRow>('SELECT * FROM merch_orders ORDER BY created_at DESC')
  return rows.map(toOrder)
}

export async function getMerchOrder(
  id: string,
  sql: Sql = db,
): Promise<{ order: MerchOrder; userId: string } | undefined> {
  const row = await sql.get<OrderRow & { user_id: string }>(
    'SELECT * FROM merch_orders WHERE id = ?',
    [id],
  )
  return row ? { order: toOrder(row), userId: row.user_id } : undefined
}

/* ── Aduan ───────────────────────────────────────────────────────────────── */

interface ComplaintRow {
  id: string
  code: string
  user_id: string
  user_name: string
  category: string
  subject: string
  status: string
  related_kind: string | null
  related_id: string | null
  related_label: string | null
  created_at: string
  updated_at: string
}

async function complaintMessages(id: string, sql: Sql): Promise<ComplaintMessage[]> {
  const rows = await sql.all<{
    id: string
    complaint_id: string
    author_role: string
    author_name: string
    body: string
    sent_at: string
  }>('SELECT * FROM complaint_messages WHERE complaint_id = ? ORDER BY sent_at ASC', [id])
  return rows.map((r) => ({
    id: r.id,
    complaintId: r.complaint_id,
    authorRole: r.author_role as ComplaintMessage['authorRole'],
    authorName: r.author_name,
    body: r.body,
    sentAt: r.sent_at,
  }))
}

async function toComplaint(r: ComplaintRow, sql: Sql): Promise<Complaint> {
  return {
    id: r.id,
    code: r.code,
    userId: r.user_id,
    userName: r.user_name,
    category: r.category as Complaint['category'],
    subject: r.subject,
    status: r.status as Complaint['status'],
    relatedKind: r.related_kind as Complaint['relatedKind'],
    relatedId: r.related_id,
    relatedLabel: r.related_label,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    messages: await complaintMessages(r.id, sql),
  }
}

export async function listComplaints(
  options: { userId?: string } = {},
  sql: Sql = db,
): Promise<Complaint[]> {
  const rows = options.userId
    ? await sql.all<ComplaintRow>(
        'SELECT * FROM complaints WHERE user_id = ? ORDER BY updated_at DESC',
        [options.userId],
      )
    : await sql.all<ComplaintRow>('SELECT * FROM complaints ORDER BY updated_at DESC')
  return Promise.all(rows.map((r) => toComplaint(r, sql)))
}

export async function findComplaint(id: string, sql: Sql = db): Promise<Complaint | undefined> {
  const row = await sql.get<ComplaintRow>('SELECT * FROM complaints WHERE id = ?', [id])
  return row ? toComplaint(row, sql) : undefined
}

export async function insertComplaint(complaint: Complaint, sql: Sql = db): Promise<void> {
  await sql.run(
    `INSERT INTO complaints (id, code, user_id, user_name, category, subject, status, related_kind, related_id, related_label, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      complaint.id,
      complaint.code,
      complaint.userId,
      complaint.userName,
      complaint.category,
      complaint.subject,
      complaint.status,
      complaint.relatedKind,
      complaint.relatedId,
      complaint.relatedLabel,
      complaint.createdAt,
      complaint.updatedAt,
    ],
  )
  for (const m of complaint.messages) {
    await addComplaintMessage(m, sql)
  }
}

export async function addComplaintMessage(m: ComplaintMessage, sql: Sql = db): Promise<void> {
  await sql.run(
    `INSERT INTO complaint_messages (id, complaint_id, author_role, author_name, body, sent_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [m.id, m.complaintId, m.authorRole, m.authorName, m.body, m.sentAt],
  )
}

export async function setComplaintStatus(
  id: string,
  status: Complaint['status'],
  sql: Sql = db,
): Promise<void> {
  await sql.run('UPDATE complaints SET status = ?, updated_at = ? WHERE id = ?', [
    status,
    now(),
    id,
  ])
}

export async function touchComplaint(
  id: string,
  status: Complaint['status'],
  sql: Sql = db,
): Promise<void> {
  await setComplaintStatus(id, status, sql)
}

/* ── Poin partisipasi ────────────────────────────────────────────────────── */

export async function awardedPoints(
  userId: string,
  activityId: string,
  sql: Sql = db,
): Promise<number | null> {
  const row = await sql.get<{ points: number }>(
    'SELECT points FROM activity_awards WHERE user_id = ? AND activity_id = ?',
    [userId, activityId],
  )
  return row ? Number(row.points) : null
}

export async function markAwarded(
  userId: string,
  activityId: string,
  points: number,
  sql: Sql = db,
): Promise<void> {
  await sql.run(
    `INSERT INTO activity_awards (user_id, activity_id, points, awarded_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, activity_id) DO NOTHING`,
    [userId, activityId, points, now()],
  )
}

/* ── Usulan waktu sparring ───────────────────────────────────────────────── */

export interface SparringProposal {
  id: string
  sparringId: string
  /** 'tuan' = pengirim ajakan, 'lawan' = yang diajak. */
  bySide: 'tuan' | 'lawan'
  byName: string
  proposedAt: string
  venueName: string | null
  note: string
  /** 'menunggu', 'diterima', atau 'diganti' oleh usulan yang lebih baru. */
  status: 'menunggu' | 'diterima' | 'diganti'
  createdAt: string
}

interface ProposalRow {
  id: string
  sparring_id: string
  by_side: string
  by_name: string
  proposed_at: string
  venue_name: string | null
  note: string
  status: string
  created_at: string
}

const toProposal = (r: ProposalRow): SparringProposal => ({
  id: r.id,
  sparringId: r.sparring_id,
  bySide: r.by_side as SparringProposal['bySide'],
  byName: r.by_name,
  proposedAt: r.proposed_at,
  venueName: r.venue_name,
  note: r.note,
  status: r.status as SparringProposal['status'],
  createdAt: r.created_at,
})

export async function listProposals(
  sparringId: string,
  sql: Sql = db,
): Promise<SparringProposal[]> {
  const rows = await sql.all<ProposalRow>(
    'SELECT * FROM sparring_proposals WHERE sparring_id = ? ORDER BY created_at ASC',
    [sparringId],
  )
  return rows.map(toProposal)
}

export async function addProposal(p: SparringProposal, sql: Sql = db): Promise<void> {
  await sql.run(
    `INSERT INTO sparring_proposals (id, sparring_id, by_side, by_name, proposed_at, venue_name, note, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      p.id,
      p.sparringId,
      p.bySide,
      p.byName,
      p.proposedAt,
      p.venueName,
      p.note,
      p.status,
      p.createdAt,
    ],
  )
}

/**
 * Usulan lama ditandai 'diganti', bukan dihapus.
 *
 * Riwayat tawar-menawar itulah yang menjelaskan bagaimana kedua tim sampai
 * pada jam yang disepakati — dan itu persis yang dicari saat salah satu pihak
 * merasa jamnya bukan yang ia setujui.
 */
export async function supersedePendingProposals(sparringId: string, sql: Sql = db): Promise<void> {
  await sql.run(
    "UPDATE sparring_proposals SET status = 'diganti' WHERE sparring_id = ? AND status = 'menunggu'",
    [sparringId],
  )
}

export async function acceptLatestProposal(sparringId: string, sql: Sql = db): Promise<void> {
  const latest = await sql.get<{ id: string }>(
    "SELECT id FROM sparring_proposals WHERE sparring_id = ? AND status = 'menunggu' ORDER BY created_at DESC LIMIT 1",
    [sparringId],
  )
  if (!latest) return
  await sql.run("UPDATE sparring_proposals SET status = 'diterima' WHERE id = ?", [latest.id])
}

/** Booking mendatang di sebuah lapangan — penjaga sebelum lapangan dihapus. */
export async function countUpcomingBookings(courtId: string, sql: Sql = db): Promise<number> {
  const row = await sql.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM bookings WHERE court_id = ? AND ends_at > ? AND status = 'confirmed'",
    [courtId, now()],
  )
  return Number(row?.n ?? 0)
}

export { uid, now }
