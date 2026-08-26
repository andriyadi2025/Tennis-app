import { create } from 'zustand'
import type { Booking, Sport, SplitBill, SplitParticipant } from '@/types'
import { STORAGE_KEYS, readJson, remove, writeJson } from '@/lib/storage'
import { computeSplit } from '@/lib/split'

/**
 * Alur booking sebagai state machine:
 *
 *   draft ──goToSummary──▶ summary ──attachBooking──▶ awaitingPayment ──confirm──▶ confirmed
 *     ▲                       │                            │
 *     └───────editSelection───┴──────expire────────────────┘
 *
 * Aturannya: begitu pilihan slot disentuh lagi, booking yang sudah dibuat di
 * server dianggap basi dan stage jatuh kembali ke `draft`. Jadi draft basi
 * tidak akan pernah bisa dibayar — `canPay()` memeriksanya, bukan sekadar
 * tombol yang di-disable.
 */
export type DraftStage = 'draft' | 'summary' | 'awaitingPayment' | 'confirmed'

interface DraftSelection {
  venueId: string | null
  venueName: string
  courtId: string | null
  courtName: string
  sport: Sport | null
  /** ISO tanggal yang sedang dilihat di strip kalender. */
  date: string | null
  startsAt: string[]
  recurrenceWeeks: number
  addOnIds: string[]
  pointsRedeemed: number
}

interface PersistedDraft extends DraftSelection {
  stage: DraftStage
  bookingId: string | null
  paymentDeadline: string | null
  splitBill: SplitBill | null
}

interface DraftState extends PersistedDraft {
  setVenue: (venueId: string, venueName: string, sport: Sport) => void
  setCourt: (courtId: string, courtName: string) => void
  setDate: (dateIso: string) => void
  setSelection: (startsAt: string[]) => void
  setRecurrenceWeeks: (weeks: number) => void
  toggleAddOn: (id: string) => void
  setPointsRedeemed: (points: number) => void

  goToSummary: () => void
  attachBooking: (booking: Booking) => void
  confirm: () => void
  expire: () => void
  reset: () => void

  setSplitParticipants: (participants: SplitParticipant[], totalIdr: number) => void
  setSplitBill: (split: SplitBill | null) => void

  /** Satu-satunya gerbang menuju pembayaran. */
  canPay: () => boolean
}

const EMPTY: PersistedDraft = {
  venueId: null,
  venueName: '',
  courtId: null,
  courtName: '',
  sport: null,
  date: null,
  startsAt: [],
  recurrenceWeeks: 1,
  addOnIds: [],
  pointsRedeemed: 0,
  stage: 'draft',
  bookingId: null,
  paymentDeadline: null,
  splitBill: null,
}

function persist(state: PersistedDraft): void {
  writeJson(STORAGE_KEYS.draft, state)
}

function snapshot(s: DraftState): PersistedDraft {
  return {
    venueId: s.venueId,
    venueName: s.venueName,
    courtId: s.courtId,
    courtName: s.courtName,
    sport: s.sport,
    date: s.date,
    startsAt: s.startsAt,
    recurrenceWeeks: s.recurrenceWeeks,
    addOnIds: s.addOnIds,
    pointsRedeemed: s.pointsRedeemed,
    stage: s.stage,
    bookingId: s.bookingId,
    paymentDeadline: s.paymentDeadline,
    splitBill: s.splitBill,
  }
}

const restored = readJson<PersistedDraft>(STORAGE_KEYS.draft, EMPTY)

/**
 * Draft tersimpan yang holdnya sudah lewat dikembalikan ke `draft` saat app
 * dibuka — tidak ada tombol bayar yang menempel pada hold mati.
 */
function rehydrate(saved: PersistedDraft): PersistedDraft {
  if (
    saved.stage === 'awaitingPayment' &&
    saved.paymentDeadline &&
    new Date(saved.paymentDeadline).getTime() <= Date.now()
  ) {
    return { ...saved, stage: 'draft', paymentDeadline: null }
  }
  return saved
}

export const useDraftStore = create<DraftState>((set, get) => ({
  ...rehydrate(restored),

  setVenue: (venueId, venueName, sport) => {
    const current = get()
    // Ganti venue = mulai dari nol; slot lapangan lama tidak relevan lagi.
    const next: PersistedDraft =
      current.venueId === venueId
        ? { ...snapshot(current), venueName, sport }
        : { ...EMPTY, venueId, venueName, sport }
    set(next)
    persist(next)
  },

  setCourt: (courtId, courtName) => {
    const current = get()
    if (current.courtId === courtId) return
    // Jam yang dipilih terikat ke satu lapangan — pindah lapangan mengosongkannya.
    const next: PersistedDraft = {
      ...snapshot(current),
      courtId,
      courtName,
      startsAt: [],
      stage: 'draft',
      bookingId: null,
      paymentDeadline: null,
    }
    set(next)
    persist(next)
  },

  setDate: (dateIso) => {
    const current = get()
    if (current.date === dateIso) return
    const next: PersistedDraft = {
      ...snapshot(current),
      date: dateIso,
      startsAt: [],
      stage: 'draft',
      bookingId: null,
      paymentDeadline: null,
    }
    set(next)
    persist(next)
  },

  setSelection: (startsAt) => {
    const next: PersistedDraft = {
      ...snapshot(get()),
      startsAt,
      // Menyentuh pilihan membatalkan booking server yang sudah dibuat.
      stage: 'draft',
      bookingId: null,
      paymentDeadline: null,
    }
    set(next)
    persist(next)
  },

  setRecurrenceWeeks: (weeks) => {
    const next: PersistedDraft = {
      ...snapshot(get()),
      recurrenceWeeks: Math.max(1, Math.floor(weeks)),
      stage: 'draft',
      bookingId: null,
      paymentDeadline: null,
    }
    set(next)
    persist(next)
  },

  toggleAddOn: (id) => {
    const current = get()
    const addOnIds = current.addOnIds.includes(id)
      ? current.addOnIds.filter((a) => a !== id)
      : [...current.addOnIds, id]
    const next: PersistedDraft = {
      ...snapshot(current),
      addOnIds,
      stage: 'draft',
      bookingId: null,
      paymentDeadline: null,
    }
    set(next)
    persist(next)
  },

  setPointsRedeemed: (points) => {
    const next: PersistedDraft = {
      ...snapshot(get()),
      pointsRedeemed: Math.max(0, Math.floor(points)),
      stage: 'draft',
      bookingId: null,
      paymentDeadline: null,
    }
    set(next)
    persist(next)
  },

  goToSummary: () => {
    const current = get()
    if (current.startsAt.length === 0) return
    const next: PersistedDraft = { ...snapshot(current), stage: 'summary' }
    set(next)
    persist(next)
  },

  attachBooking: (booking) => {
    const next: PersistedDraft = {
      ...snapshot(get()),
      stage: 'awaitingPayment',
      bookingId: booking.id,
      paymentDeadline: booking.paymentDeadline,
    }
    set(next)
    persist(next)
  },

  confirm: () => {
    const next: PersistedDraft = { ...snapshot(get()), stage: 'confirmed', paymentDeadline: null }
    set(next)
    persist(next)
  },

  expire: () => {
    // `bookingId` sengaja dipertahankan: layar pembayaran masih perlu
    // menunjukkan booking mana yang holdnya habis. Yang menutup pembayaran
    // adalah stage + deadline, dan itulah yang diperiksa `canPay()`.
    const next: PersistedDraft = {
      ...snapshot(get()),
      stage: 'draft',
      paymentDeadline: null,
    }
    set(next)
    persist(next)
  },

  reset: () => {
    set(EMPTY)
    remove(STORAGE_KEYS.draft)
  },

  setSplitParticipants: (participants, totalIdr) => {
    const current = get()
    const existing = current.splitBill
    const computed = computeSplit(totalIdr, participants)
    const splitBill: SplitBill = {
      ...computed,
      // Status lunas peserta yang masih ada tetap dipertahankan.
      paidBy: (existing?.paidBy ?? []).filter((id) => participants.some((p) => p.id === id)),
    }
    const next: PersistedDraft = { ...snapshot(current), splitBill }
    set(next)
    persist(next)
  },

  setSplitBill: (splitBill) => {
    const next: PersistedDraft = { ...snapshot(get()), splitBill }
    set(next)
    persist(next)
  },

  canPay: () => {
    const s = get()
    if (s.stage !== 'awaitingPayment') return false
    if (!s.bookingId) return false
    if (!s.paymentDeadline) return false
    return new Date(s.paymentDeadline).getTime() > Date.now()
  },
}))
