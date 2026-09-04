import type { BookingRange, Slot } from './types.ts'
import { addHours, addWeeks, dayKey, formatHour, parseISO } from './dates.ts'

const HOUR_MS = 3_600_000

export function slotKey(courtId: string, startsAt: string): string {
  return `${courtId}|${startsAt}`
}

/** Urut naik berdasarkan waktu mulai. */
export function sortSlotTimes(startsAt: readonly string[]): string[] {
  return [...startsAt].sort((a, b) => parseISO(a).getTime() - parseISO(b).getTime())
}

/**
 * Slot berdurasi 1 jam, jadi "bersambung" berarti tiap waktu mulai berjarak
 * tepat 1 jam dari sebelumnya. Nol atau satu slot selalu dianggap sah.
 */
export function isContiguous(startsAt: readonly string[]): boolean {
  if (startsAt.length <= 1) return true
  const sorted = sortSlotTimes(startsAt).map((s) => parseISO(s).getTime())
  return sorted.every((t, i) => i === 0 || t - sorted[i - 1]! === HOUR_MS)
}

export type SelectionError =
  | { kind: 'booked'; message: string }
  | { kind: 'notContiguous'; message: string }
  | { kind: 'breaksBlock'; message: string }

export interface ToggleResult {
  selected: string[]
  error: SelectionError | null
}

/**
 * Aturan pilih slot:
 *  · slot penuh tidak bisa dipilih;
 *  · slot baru harus menempel di ujung blok yang sudah dipilih;
 *  · hanya slot di ujung yang bisa dilepas, supaya blok tidak terbelah.
 */
export function toggleSlot(
  selected: readonly string[],
  candidate: string,
  slots: readonly Slot[],
): ToggleResult {
  const current = sortSlotTimes(selected)
  const slot = slots.find((s) => s.startsAt === candidate)

  if (current.includes(candidate)) {
    const isEdge = current[0] === candidate || current[current.length - 1] === candidate
    if (!isEdge) {
      return {
        selected: current,
        error: {
          kind: 'breaksBlock',
          message: 'Jam di tengah tidak bisa dilepas — jadwal harus tetap bersambung.',
        },
      }
    }
    return { selected: current.filter((s) => s !== candidate), error: null }
  }

  if (!slot || slot.status === 'booked') {
    return {
      selected: current,
      error: { kind: 'booked', message: 'Slot ini sudah penuh.' },
    }
  }

  if (current.length === 0) return { selected: [candidate], error: null }

  const next = sortSlotTimes([...current, candidate])
  if (!isContiguous(next)) {
    return {
      selected: current,
      error: {
        kind: 'notContiguous',
        message: 'Pilih jam yang bersambung. Lepas dulu pilihan sebelumnya kalau mau pindah jam.',
      },
    }
  }
  return { selected: next, error: null }
}

/** Rentang booking dari daftar slot terpilih. */
export function toRange(startsAt: readonly string[]): BookingRange | null {
  if (startsAt.length === 0) return null
  const sorted = sortSlotTimes(startsAt)
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  return {
    startsAt: first,
    endsAt: addHours(parseISO(last), 1).toISOString(),
    hours: sorted.length,
  }
}

/** "19.00 – 21.00" dari daftar slot. */
export function describeSelection(startsAt: readonly string[]): string {
  const range = toRange(startsAt)
  if (!range) return ''
  return `${formatHour(range.startsAt)} – ${formatHour(range.endsAt)}`
}

export interface RecurrenceConflict {
  /** Minggu ke-berapa dari sekarang (1 = minggu depan). */
  weekOffset: number
  date: string
  /** Jam yang bentrok, sudah diformat ("19.00"). */
  hours: string[]
}

/** Pengecekan ketersediaan slot pada tanggal mana pun di masa depan. */
export type AvailabilityLookup = (courtId: string, startsAtIso: string) => boolean

/**
 * Untuk toggle "ulangi tiap Jumat, 4 minggu": ulang slot terpilih di minggu
 * berikutnya dan laporkan yang sudah terisi. Minggu pertama tidak dicek —
 * itu booking aslinya yang sudah divalidasi di grid.
 */
export function findRecurrenceConflicts(
  courtId: string,
  startsAt: readonly string[],
  weeks: number,
  isAvailable: AvailabilityLookup,
): RecurrenceConflict[] {
  const sorted = sortSlotTimes(startsAt)
  if (sorted.length === 0 || weeks <= 1) return []

  const conflicts: RecurrenceConflict[] = []
  for (let week = 1; week < Math.floor(weeks); week += 1) {
    const clashes: string[] = []
    let date = ''
    for (const iso of sorted) {
      const future = addWeeks(parseISO(iso), week)
      const futureIso = future.toISOString()
      if (!date) date = dayKey(future)
      if (!isAvailable(courtId, futureIso)) clashes.push(formatHour(future))
    }
    if (clashes.length > 0) conflicts.push({ weekOffset: week, date, hours: clashes })
  }
  return conflicts
}

/** Jumlah minggu yang benar-benar bisa dikunci sebelum bentrokan pertama. */
export function bookableWeeks(weeks: number, conflicts: RecurrenceConflict[]): number {
  if (conflicts.length === 0) return weeks
  const first = Math.min(...conflicts.map((c) => c.weekOffset))
  return first
}
