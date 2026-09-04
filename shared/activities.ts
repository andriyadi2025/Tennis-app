import type {
  Activity,
  ActivityKind,
  ActivityPoints,
  ActivityTally,
  Booking,
  OpenMatch,
  SparringInvite,
  Tournament,
  TournamentRegistration,
} from './types.ts'

/**
 * Catatan aktivitas diturunkan dari kejadian yang sudah tersimpan, bukan
 * ditulis sebagai baris terpisah saat kejadian berlangsung.
 *
 * Alasannya: dua tempat menyimpan hal yang sama akan menyimpang cepat atau
 * lambat — booking dibatalkan tapi catatannya tertinggal, atau sebaliknya.
 * Dengan diturunkan, catatan tidak bisa berbeda dari kejadiannya, dan
 * booking lama pun ikut tercatat surut tanpa migrasi.
 */

export const EMPTY_TALLY: ActivityTally = {
  bermain: 0,
  berlatih: 0,
  mainBersama: 0,
  lomba: 0,
}

export interface ActivitySources {
  bookings: readonly Booking[]
  openMatches: readonly OpenMatch[]
  tournaments: readonly Tournament[]
  registrations: readonly TournamentRegistration[]
  sparring: readonly SparringInvite[]
  /** Id user, untuk menyaring open match yang benar-benar diikuti. */
  userId: string
  points: ActivityPoints
}

function hasPassed(iso: string, now: Date): boolean {
  return new Date(iso).getTime() <= now.getTime()
}

/**
 * Sebuah kegiatan baru tercatat setelah benar-benar terjadi. Booking untuk
 * minggu depan bukan kegiatan yang sudah dilakukan, dan memberinya poin akan
 * membuat orang bisa memanen poin lalu membatalkannya.
 */
export function deriveActivities(sources: ActivitySources, now: Date = new Date()): Activity[] {
  const { points, userId } = sources
  const out: Activity[] = []

  for (const booking of sources.bookings) {
    if (booking.status !== 'confirmed') continue
    if (!hasPassed(booking.range.endsAt, now)) continue
    const kind: ActivityKind = booking.purpose === 'berlatih' ? 'berlatih' : 'bermain'
    out.push({
      id: `booking:${booking.id}`,
      kind,
      source: 'booking',
      sourceId: booking.id,
      title: `${booking.venueName} · ${booking.courtName}`,
      sport: booking.sport,
      occurredAt: booking.range.startsAt,
      venueName: booking.venueName,
      // Peserta split bill adalah orang yang benar-benar ikut main.
      withNames: (booking.splitBill?.participants ?? [])
        .filter((p) => !p.isHost)
        .map((p) => p.name),
      pointsEarned: points[kind],
    })
  }

  for (const match of sources.openMatches) {
    if (!match.players.some((p) => p.id === userId)) continue
    const endsAt = new Date(new Date(match.startsAt).getTime() + match.hours * 3_600_000)
    if (!hasPassed(endsAt.toISOString(), now)) continue
    out.push({
      id: `openMatch:${match.id}`,
      kind: 'mainBersama',
      source: 'openMatch',
      sourceId: match.id,
      title: match.title,
      sport: match.sport,
      occurredAt: match.startsAt,
      venueName: match.venueName,
      withNames: match.players.filter((p) => p.id !== userId).map((p) => p.name),
      pointsEarned: points.mainBersama,
    })
  }

  for (const registration of sources.registrations) {
    const tournament = sources.tournaments.find((t) => t.id === registration.tournamentId)
    if (!tournament) continue
    // Turnamen dihitung begitu mulai — pesertanya sudah hadir dan bertanding.
    if (!hasPassed(tournament.startsAt, now)) continue
    out.push({
      id: `tournament:${registration.id}`,
      kind: 'lomba',
      source: 'tournament',
      sourceId: registration.id,
      title: tournament.name,
      sport: tournament.sport,
      occurredAt: tournament.startsAt,
      venueName: tournament.venueName,
      withNames: [],
      pointsEarned: points.lomba,
    })
  }

  for (const invite of sources.sparring) {
    if (invite.status !== 'diterima') continue
    // Ajakan tanpa waktu belum bisa dihitung terjadi.
    if (!invite.proposedAt || !hasPassed(invite.proposedAt, now)) continue
    const other = invite.direction === 'masuk' ? invite.fromTeamName : invite.toTeamName
    out.push({
      id: `sparring:${invite.id}`,
      kind: 'mainBersama',
      source: 'sparring',
      sourceId: invite.id,
      title: `Sparring lawan ${other}`,
      sport: invite.sport,
      occurredAt: invite.proposedAt,
      venueName: invite.venueName,
      withNames: [other],
      pointsEarned: points.mainBersama,
    })
  }

  // Terbaru di atas — itu yang orang cari lebih dulu di riwayat.
  return out.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
}

export function tallyActivities(activities: readonly Activity[]): ActivityTally {
  const tally = { ...EMPTY_TALLY }
  for (const activity of activities) tally[activity.kind] += 1
  return tally
}

/** Jumlah kegiatan yang melibatkan bermain, dipakai sebagai "x main". */
export function matchesPlayed(tally: ActivityTally): number {
  return tally.bermain + tally.mainBersama + tally.lomba
}

export function totalActivityPoints(activities: readonly Activity[]): number {
  return activities.reduce((sum, activity) => sum + activity.pointsEarned, 0)
}

export interface SettledActivities {
  activities: Activity[]
  /** Poin yang baru dikreditkan kali ini; 0 kalau semuanya sudah pernah. */
  credited: number
}

/**
 * Menyelesaikan poin tiap kegiatan terhadap catatan kredit yang sudah ada.
 *
 * Kegiatan yang pernah dikreditkan memakai angka lamanya, bukan tarif hari
 * ini: kalau admin menurunkan poin Lomba dari 150 ke 10, riwayat lama tetap
 * harus menulis +150 — itu yang benar-benar masuk ke saldo. Menghitung ulang
 * riwayat dengan tarif baru membuat catatan berbohong tentang masa lalu.
 */
export function settleActivities(
  activities: readonly Activity[],
  awardedPoints: (id: string) => number | null,
  onAward: (id: string, points: number) => void,
): SettledActivities {
  let credited = 0
  const settled = activities.map((activity) => {
    const previous = awardedPoints(activity.id)
    if (previous !== null) return { ...activity, pointsEarned: previous }
    onAward(activity.id, activity.pointsEarned)
    credited += activity.pointsEarned
    return activity
  })
  return { activities: settled, credited }
}
