import type { Complaint, ComplaintStatus, Role } from './types.ts'

/**
 * Status aduan mengikuti percakapannya, bukan tombol terpisah.
 *
 * Kalau status hanya berubah saat admin menekan sesuatu, daftar aduan akan
 * penuh "Baru" yang sebenarnya sudah dijawab, dan "Selesai" yang sebenarnya
 * masih dipersoalkan. Membalas adalah tindakan yang paling jujur menandakan
 * apa yang sedang terjadi, jadi itulah yang menggerakkan statusnya.
 */
export function statusAfterReply(current: ComplaintStatus, author: Role): ComplaintStatus {
  if (author === 'admin') {
    // Klub sudah menjawab — aduan tidak lagi "baru", tapi juga belum selesai.
    return current === 'selesai' ? 'selesai' : 'diproses'
  }
  // Anggota menulis lagi setelah ditutup berarti persoalannya belum beres.
  return current === 'selesai' ? 'diproses' : current
}

export function isOpen(status: ComplaintStatus): boolean {
  return status !== 'selesai'
}

/** Pesan terakhir — yang menentukan urutan daftar dan siapa yang ditunggu. */
export function lastMessage(complaint: Complaint): Complaint['messages'][number] | undefined {
  return complaint.messages[complaint.messages.length - 1]
}

/**
 * Aduan yang menunggu jawaban klub: pesan terakhirnya dari anggota dan
 * belum selesai. Dipakai lencana di dasbor admin.
 */
export function awaitingAdmin(complaint: Complaint): boolean {
  if (!isOpen(complaint.status)) return false
  const last = lastMessage(complaint)
  return last ? last.authorRole === 'member' : true
}

export function countAwaitingAdmin(complaints: readonly Complaint[]): number {
  return complaints.filter(awaitingAdmin).length
}

/** Urutan daftar: yang paling baru bergerak di atas. */
export function sortByActivity(complaints: readonly Complaint[]): Complaint[] {
  return [...complaints].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )
}

export interface ComplaintDraftInput {
  subject: string
  body: string
}

/**
 * Aduan tanpa judul atau isi tidak bisa ditindaklanjuti siapa pun. Batas
 * atasnya menahan kiriman yang tidak wajar, bukan membatasi keluhan panjang.
 */
export function validateDraft({ subject, body }: ComplaintDraftInput): string | null {
  const judul = subject.trim()
  const isi = body.trim()
  if (judul.length < 4) return 'Judul terlalu pendek — tulis pokok masalahnya.'
  if (judul.length > 80) return 'Judul maksimal 80 karakter.'
  if (isi.length < 10) return 'Ceritakan sedikit lebih jelas supaya bisa ditindaklanjuti.'
  if (isi.length > 2_000) return 'Pesan maksimal 2.000 karakter.'
  return null
}

export function validateReply(body: string): string | null {
  const isi = body.trim()
  if (!isi) return 'Pesan tidak boleh kosong.'
  if (isi.length > 2_000) return 'Pesan maksimal 2.000 karakter.'
  return null
}
