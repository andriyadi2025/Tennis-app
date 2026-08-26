import type { SplitBill, SplitParticipant } from '@/types'

/**
 * Membagi total ke peserta. Rupiah tidak punya pecahan sen, jadi pembagian
 * dibulatkan ke bawah dan **sisanya ditanggung host** — bukan disebar, supaya
 * angka yang ditagih ke tiap peserta selalu sama persis.
 */
export function computeSplit(totalIdr: number, participants: SplitParticipant[]): SplitBill {
  const count = participants.length
  if (count === 0) {
    return { participants, amountPerPersonIdr: 0, hostRemainderIdr: 0, paidBy: [] }
  }
  const total = Math.max(0, Math.round(totalIdr))
  const amountPerPersonIdr = Math.floor(total / count)
  const hostRemainderIdr = total - amountPerPersonIdr * count
  return { participants, amountPerPersonIdr, hostRemainderIdr, paidBy: [] }
}

/** Nominal yang harus dibayar satu peserta (host menanggung sisa pembulatan). */
export function amountFor(split: SplitBill, participantId: string): number {
  const person = split.participants.find((p) => p.id === participantId)
  if (!person) return 0
  return split.amountPerPersonIdr + (person.isHost ? split.hostRemainderIdr : 0)
}

/** Total yang sudah masuk dari peserta yang menandai lunas. */
export function paidAmount(split: SplitBill): number {
  return split.paidBy.reduce((sum, id) => sum + amountFor(split, id), 0)
}

export function splitTotal(split: SplitBill): number {
  return split.amountPerPersonIdr * split.participants.length + split.hostRemainderIdr
}

/** 0–1 untuk progress bar "sudah bayar". */
export function paidRatio(split: SplitBill): number {
  const total = splitTotal(split)
  if (total <= 0) return 0
  return Math.min(1, paidAmount(split) / total)
}

export function isFullyPaid(split: SplitBill): boolean {
  return split.participants.length > 0 && split.paidBy.length === split.participants.length
}

/** Menambah peserta lalu menghitung ulang pembagian pada total yang sama. */
export function addParticipant(
  split: SplitBill,
  person: SplitParticipant,
  totalIdr: number,
): SplitBill {
  if (split.participants.some((p) => p.id === person.id)) return split
  const next = computeSplit(totalIdr, [...split.participants, person])
  // Status lunas peserta lama dipertahankan — nominalnya saja yang berubah.
  return { ...next, paidBy: split.paidBy }
}

export function removeParticipant(
  split: SplitBill,
  participantId: string,
  totalIdr: number,
): SplitBill {
  const remaining = split.participants.filter((p) => p.id !== participantId)
  if (remaining.length === split.participants.length) return split
  const next = computeSplit(totalIdr, remaining)
  return { ...next, paidBy: split.paidBy.filter((id) => id !== participantId) }
}

export function togglePaid(split: SplitBill, participantId: string): SplitBill {
  const isPaid = split.paidBy.includes(participantId)
  return {
    ...split,
    paidBy: isPaid
      ? split.paidBy.filter((id) => id !== participantId)
      : [...split.paidBy, participantId],
  }
}
