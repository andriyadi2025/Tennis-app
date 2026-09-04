import { describe, expect, it } from 'vitest'
import type {
  ActivityPoints,
  Booking,
  OpenMatch,
  SparringInvite,
  Tournament,
  TournamentRegistration,
} from '@/types'
import {
  deriveActivities,
  matchesPlayed,
  settleActivities,
  tallyActivities,
  totalActivityPoints,
} from './activities'

const NOW = new Date('2026-09-04T12:00:00.000Z')
const KEMARIN = '2026-09-03T10:00:00.000Z'
const BESOK = '2026-09-05T10:00:00.000Z'

const POINTS: ActivityPoints = { bermain: 25, berlatih: 40, mainBersama: 50, lomba: 150 }
const USER = 'u-raka'

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'bk-1',
    venueId: 'v-dbtc',
    venueName: 'Dukuh Bima Tennis Club',
    courtId: 'v-dbtc-c1',
    courtName: 'Lap. 1',
    sport: 'tennis',
    range: { startsAt: KEMARIN, endsAt: '2026-09-03T12:00:00.000Z', hours: 2 },
    recurrence: null,
    purpose: 'bermain',
    addOns: [],
    splitBill: null,
    status: 'confirmed',
    paymentMethod: 'qris',
    code: 'DBTC-AAA111',
    subtotalIdr: 120_000,
    pointsRedeemed: 0,
    discountIdr: 0,
    serviceFeeIdr: 5_000,
    totalIdr: 125_000,
    createdAt: KEMARIN,
    paymentDeadline: null,
    ...overrides,
  }
}

function match(overrides: Partial<OpenMatch> = {}): OpenMatch {
  return {
    id: 'om-1',
    title: 'Tenis ganda santai',
    sport: 'tennis',
    venueId: 'v-dbtc',
    venueName: 'Dukuh Bima Tennis Club',
    district: 'Bandung Utara',
    startsAt: KEMARIN,
    hours: 2,
    level: 'menengah',
    pricePerPersonIdr: 35_000,
    slotsTotal: 4,
    players: [
      { id: USER, name: 'Raka', level: 'menengah' },
      { id: 'p-2', name: 'Dimas', level: 'menengah' },
    ],
    hostName: 'Dimas',
    note: '',
    chatId: 'chat-1',
    ...overrides,
  }
}

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 'trn-1',
    name: 'DBTC Open',
    sport: 'tennis',
    venueName: 'Dukuh Bima Tennis Club',
    city: 'Bandung',
    startsAt: KEMARIN,
    endsAt: '2026-09-03T18:00:00.000Z',
    entryFeeIdr: 150_000,
    prizePoolIdr: 8_000_000,
    slotsTotal: 32,
    slotsTaken: 24,
    status: 'berlangsung',
    photo: { tone: 'accent', step: 300, seed: 1 },
    ...overrides,
  }
}

function registration(overrides: Partial<TournamentRegistration> = {}): TournamentRegistration {
  return {
    id: 'trg-1',
    tournamentId: 'trn-1',
    tournamentName: 'DBTC Open',
    entryFeeIdr: 150_000,
    paymentMethod: 'qris',
    paymentStatus: 'lunas',
    registeredAt: KEMARIN,
    code: 'TRN-AAA111',
    ...overrides,
  }
}

function sparring(overrides: Partial<SparringInvite> = {}): SparringInvite {
  return {
    id: 'sp-1',
    direction: 'masuk',
    fromTeamId: 't-hoops',
    fromTeamName: 'Bandung Hoops',
    toTeamId: 't-garuda',
    toTeamName: 'Garuda Muda FC',
    sport: 'tennis',
    proposedAt: KEMARIN,
    venueName: 'Dukuh Bima Tennis Club',
    message: '',
    status: 'diterima',
    createdAt: KEMARIN,
    ...overrides,
  }
}

const EMPTY = {
  bookings: [],
  openMatches: [],
  tournaments: [],
  registrations: [],
  sparring: [],
  userId: USER,
  points: POINTS,
}

describe('booking → Bermain / Berlatih', () => {
  it('mencatat booking lunas yang sudah lewat sebagai Bermain', () => {
    const [activity] = deriveActivities({ ...EMPTY, bookings: [booking()] }, NOW)
    expect(activity?.kind).toBe('bermain')
    expect(activity?.pointsEarned).toBe(25)
    expect(activity?.id).toBe('booking:bk-1')
  })

  it('mengikuti tujuan booking untuk membedakan latihan', () => {
    const [activity] = deriveActivities(
      { ...EMPTY, bookings: [booking({ purpose: 'berlatih' })] },
      NOW,
    )
    expect(activity?.kind).toBe('berlatih')
    expect(activity?.pointsEarned).toBe(40)
  })

  it('tidak mencatat booking yang belum terjadi', () => {
    const nanti = booking({
      range: { startsAt: BESOK, endsAt: '2026-09-05T12:00:00.000Z', hours: 2 },
    })
    // Kalau ini dihitung, orang bisa memanen poin lalu membatalkannya.
    expect(deriveActivities({ ...EMPTY, bookings: [nanti] }, NOW)).toHaveLength(0)
  })

  it('tidak mencatat booking yang belum dibayar atau kedaluwarsa', () => {
    for (const status of ['draft', 'summary', 'awaitingPayment', 'expired'] as const) {
      expect(deriveActivities({ ...EMPTY, bookings: [booking({ status })] }, NOW)).toHaveLength(0)
    }
  })

  it('mencatat peserta split bill sebagai teman main', () => {
    const withFriends = booking({
      splitBill: {
        participants: [
          { id: 'h', name: 'Raka', isHost: true },
          { id: 'a', name: 'Dimas', isHost: false },
          { id: 'b', name: 'Rani', isHost: false },
        ],
        amountPerPersonIdr: 40_000,
        hostRemainderIdr: 0,
        paidBy: [],
      },
    })
    const [activity] = deriveActivities({ ...EMPTY, bookings: [withFriends] }, NOW)
    // Host adalah user sendiri, jadi tidak ikut disebut sebagai teman.
    expect(activity?.withNames).toEqual(['Dimas', 'Rani'])
  })
})

describe('open match → Main bersama', () => {
  it('mencatat open match yang diikuti dan sudah selesai', () => {
    const [activity] = deriveActivities({ ...EMPTY, openMatches: [match()] }, NOW)
    expect(activity?.kind).toBe('mainBersama')
    expect(activity?.pointsEarned).toBe(50)
    expect(activity?.withNames).toEqual(['Dimas'])
  })

  it('mengabaikan open match yang tidak diikuti user', () => {
    const orangLain = match({ players: [{ id: 'p-9', name: 'Lain', level: 'pemula' }] })
    expect(deriveActivities({ ...EMPTY, openMatches: [orangLain] }, NOW)).toHaveLength(0)
  })

  it('mengabaikan open match yang belum selesai', () => {
    // Mulai satu jam lalu, durasi dua jam — belum bubar.
    const berlangsung = match({ startsAt: '2026-09-04T11:00:00.000Z', hours: 2 })
    expect(deriveActivities({ ...EMPTY, openMatches: [berlangsung] }, NOW)).toHaveLength(0)
  })
})

describe('turnamen → Lomba', () => {
  it('mencatat pendaftaran turnamen yang sudah berjalan', () => {
    const [activity] = deriveActivities(
      { ...EMPTY, tournaments: [tournament()], registrations: [registration()] },
      NOW,
    )
    expect(activity?.kind).toBe('lomba')
    expect(activity?.pointsEarned).toBe(150)
    expect(activity?.title).toBe('DBTC Open')
  })

  it('belum mencatat turnamen yang baru akan datang', () => {
    const nanti = tournament({ startsAt: BESOK, status: 'pendaftaran' })
    expect(
      deriveActivities({ ...EMPTY, tournaments: [nanti], registrations: [registration()] }, NOW),
    ).toHaveLength(0)
  })

  it('mengabaikan pendaftaran yang turnamennya tidak ada', () => {
    expect(
      deriveActivities({ ...EMPTY, tournaments: [], registrations: [registration()] }, NOW),
    ).toHaveLength(0)
  })
})

describe('sparring → Main bersama', () => {
  it('mencatat sparring yang diterima dan sudah lewat', () => {
    const [activity] = deriveActivities({ ...EMPTY, sparring: [sparring()] }, NOW)
    expect(activity?.kind).toBe('mainBersama')
    expect(activity?.withNames).toEqual(['Bandung Hoops'])
  })

  it('mengabaikan ajakan yang belum dijawab atau ditolak', () => {
    for (const status of ['menunggu', 'ditolak'] as const) {
      expect(deriveActivities({ ...EMPTY, sparring: [sparring({ status })] }, NOW)).toHaveLength(0)
    }
  })

  it('mengabaikan ajakan tanpa waktu yang disepakati', () => {
    // Tanpa waktu, tidak ada dasar untuk bilang kegiatannya sudah terjadi.
    expect(
      deriveActivities({ ...EMPTY, sparring: [sparring({ proposedAt: null })] }, NOW),
    ).toHaveLength(0)
  })
})

describe('kumpulan catatan', () => {
  const semua = {
    ...EMPTY,
    bookings: [booking(), booking({ id: 'bk-2', purpose: 'berlatih' })],
    openMatches: [match()],
    tournaments: [tournament()],
    registrations: [registration()],
    sparring: [sparring()],
  }

  it('memberi id yang stabil dan unik per sumber', () => {
    const ids = deriveActivities(semua, NOW).map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    // Id yang stabil itulah yang mencegah poin dikreditkan dua kali.
    expect(deriveActivities(semua, NOW).map((a) => a.id)).toEqual(ids)
  })

  it('mengurutkan dari yang terbaru', () => {
    const lama = booking({
      id: 'bk-lama',
      range: { startsAt: '2026-08-01T10:00:00.000Z', endsAt: '2026-08-01T12:00:00.000Z', hours: 2 },
    })
    const activities = deriveActivities({ ...semua, bookings: [lama, booking()] }, NOW)
    const waktu = activities.map((a) => new Date(a.occurredAt).getTime())
    expect(waktu).toEqual([...waktu].sort((a, b) => b - a))
  })

  it('menghitung ringkasan per jenis', () => {
    const tally = tallyActivities(deriveActivities(semua, NOW))
    expect(tally).toEqual({ bermain: 1, berlatih: 1, mainBersama: 2, lomba: 1 })
  })

  it('menjumlahkan poin partisipasi', () => {
    // 25 + 40 + 50 + 50 + 150
    expect(totalActivityPoints(deriveActivities(semua, NOW))).toBe(315)
  })

  it('menghitung jumlah main dari jenis yang melibatkan bertanding', () => {
    const tally = tallyActivities(deriveActivities(semua, NOW))
    // Berlatih tidak dihitung sebagai "main".
    expect(matchesPlayed(tally)).toBe(4)
  })

  it('mengikuti poin yang diatur admin, bukan angka tetap', () => {
    const murah = { ...POINTS, lomba: 10 }
    const activities = deriveActivities({ ...semua, points: murah }, NOW)
    expect(activities.find((a) => a.kind === 'lomba')?.pointsEarned).toBe(10)
  })
})

describe('settleActivities', () => {
  function ledger(initial: Record<string, number> = {}) {
    const awarded = new Map(Object.entries(initial))
    return {
      awarded,
      read: (id: string) => awarded.get(id) ?? null,
      write: (id: string, points: number) => {
        awarded.set(id, points)
      },
    }
  }

  const activities = () => deriveActivities({ ...EMPTY, bookings: [booking()] }, NOW)

  it('mengkreditkan kegiatan yang baru pertama muncul', () => {
    const l = ledger()
    const { credited, activities: out } = settleActivities(activities(), l.read, l.write)
    expect(credited).toBe(25)
    expect(out[0]?.pointsEarned).toBe(25)
    expect(l.awarded.get('booking:bk-1')).toBe(25)
  })

  it('tidak mengkreditkan ulang kegiatan yang sama', () => {
    const l = ledger()
    settleActivities(activities(), l.read, l.write)
    // Membuka profil kedua kali tidak boleh menambah poin lagi.
    expect(settleActivities(activities(), l.read, l.write).credited).toBe(0)
  })

  it('menulis poin yang dulu dikreditkan, bukan tarif hari ini', () => {
    // Admin sudah menurunkan poin sejak kegiatan ini dicatat.
    const l = ledger({ 'booking:bk-1': 25 })
    const murah = deriveActivities(
      { ...EMPTY, bookings: [booking()], points: { ...POINTS, bermain: 5 } },
      NOW,
    )
    const { activities: out, credited } = settleActivities(murah, l.read, l.write)
    // Riwayat harus jujur soal apa yang benar-benar masuk ke saldo.
    expect(out[0]?.pointsEarned).toBe(25)
    expect(credited).toBe(0)
  })

  it('memakai tarif baru untuk kegiatan yang belum pernah dikreditkan', () => {
    const l = ledger({ 'booking:bk-1': 25 })
    const baru = deriveActivities(
      {
        ...EMPTY,
        bookings: [booking(), booking({ id: 'bk-2' })],
        points: { ...POINTS, bermain: 5 },
      },
      NOW,
    )
    const { activities: out, credited } = settleActivities(baru, l.read, l.write)
    expect(credited).toBe(5)
    expect(out.find((a) => a.sourceId === 'bk-2')?.pointsEarned).toBe(5)
  })
})
