import { Link } from 'react-router-dom'
import type { Complaint } from '@/types'
import { COMPLAINT_CATEGORY_LABEL, COMPLAINT_STATUS_LABEL } from '@/types'
import { awaitingAdmin, lastMessage } from '@/lib/complaints'
import { formatRelative } from '@/lib/dates'
import { Chip } from '@/components/ui/primitives'
import { COMPLAINT_STATUS_TONE } from './complaintTone'

/**
 * Satu baris aduan, dipakai daftar anggota dan dasbor admin.
 *
 * Barisnya sengaja menampilkan penggal pesan terakhir beserta penulisnya:
 * yang orang cari saat memindai daftar bukan judulnya, melainkan giliran
 * siapa sekarang.
 */
export function ComplaintRow({
  complaint,
  showAuthor = false,
}: {
  complaint: Complaint
  /** Dasbor admin perlu tahu siapa yang mengadu; anggota tidak. */
  showAuthor?: boolean
}) {
  const last = lastMessage(complaint)
  const menunggu = awaitingAdmin(complaint)

  return (
    <Link
      to={`/bantuan/${complaint.id}`}
      className="flex flex-col gap-2 rounded-lg bg-surface p-4 transition-colors hover:bg-neutral-200"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex-1 text-md font-bold leading-snug">{complaint.subject}</h3>
        <Chip tone={COMPLAINT_STATUS_TONE[complaint.status]}>
          {COMPLAINT_STATUS_LABEL[complaint.status]}
        </Chip>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-600">
        <span>{complaint.code}</span>
        <span aria-hidden>·</span>
        <span>{COMPLAINT_CATEGORY_LABEL[complaint.category]}</span>
        {showAuthor && (
          <>
            <span aria-hidden>·</span>
            <span>{complaint.userName}</span>
          </>
        )}
      </div>

      {last && (
        <p className="line-clamp-2 text-base text-neutral-700">
          {/* "Kamu" hanya benar di daftar milik sendiri. Di dasbor admin,
              pesan anggota ditulis orang lain — menyebutnya "Kamu" membuat
              pengurus mengira ia sendiri yang menulisnya. */}
          <span className="font-semibold">
            {last.authorRole === 'admin' ? 'Klub: ' : showAuthor ? 'Anggota: ' : 'Kamu: '}
          </span>
          {last.body}
        </p>
      )}

      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm text-neutral-600">
          {formatRelative(complaint.updatedAt)}
        </span>
        {menunggu && <Chip tone="accent">Menunggu jawaban klub</Chip>}
      </div>
    </Link>
  )
}
