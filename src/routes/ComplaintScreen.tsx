import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import clsx from 'clsx'
import { Send } from 'lucide-react'
import type { Complaint, ComplaintMessage, ComplaintStatus } from '@/types'
import { COMPLAINT_CATEGORY_LABEL, COMPLAINT_STATUS_LABEL } from '@/types'
import { queryKeys, useComplaint, useReplyComplaint, useSetComplaintStatus } from '@/hooks/queries'
import { useLiveChannel } from '@/hooks/useLiveChannel'
import { useAuthStore } from '@/store/auth'
import { validateReply } from '@/lib/complaints'
import { formatDateLong, formatRelative } from '@/lib/dates'
import { ScreenHeader, StickyBar } from '@/components/layout/Screen'
import { Icon } from '@/components/ui/Icon'
import { Avatar, Chip } from '@/components/ui/primitives'
import { ErrorState, RowSkeleton } from '@/components/ui/states'
import { COMPLAINT_STATUS_TONE } from '@/components/domain/complaintTone'

const NEXT_STATUS: ComplaintStatus[] = ['diproses', 'selesai']

/**
 * Satu utas aduan, dipakai anggota **dan** admin.
 *
 * Bukan dua layar yang mirip: kalau tiap peran punya salinan sendiri, cepat
 * atau lambat salah satunya menampilkan percakapan yang tidak lengkap. Yang
 * berbeda cuma kendali status, yang memang hanya milik admin.
 */
export function ComplaintScreen() {
  const { id } = useParams<{ id: string }>()
  const complaint = useComplaint(id)
  const reply = useReplyComplaint(id)
  const setStatus = useSetComplaintStatus(id)

  // Balasan klub muncul tanpa perlu menutup dan membuka layar ini lagi.
  useLiveChannel(id ? `/api/complaints/${id}/stream` : null, [
    queryKeys.complaint(id ?? ''),
    queryKeys.complaints,
  ])
  const isAdmin = useAuthStore((s) => s.user?.role) === 'admin'
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [complaint.data?.messages.length])

  const invalid = validateReply(text)

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-bg">
      <div className="scroll-area flex flex-1 flex-col gap-5 px-5 pb-4 pt-5">
        <ScreenHeader title={complaint.data?.subject ?? 'Aduan'} />

        {complaint.isLoading ? (
          <RowSkeleton count={3} />
        ) : complaint.error || !complaint.data ? (
          <ErrorState
            body={complaint.error?.message ?? 'Aduan tidak ditemukan.'}
            onRetry={() => void complaint.refetch()}
          />
        ) : (
          <>
            <Header complaint={complaint.data} />

            {isAdmin && (
              <AdminControls
                current={complaint.data.status}
                busy={setStatus.isPending}
                onChange={(status) => setStatus.mutate(status)}
              />
            )}

            <ul className="flex flex-col gap-3">
              {complaint.data.messages.map((message) => (
                <li key={message.id}>
                  <Bubble
                    message={message}
                    /* "Milikku" ditentukan oleh peran pembaca, bukan id
                       penulis — admin membaca utas anggota lain juga. */
                    mine={message.authorRole === (isAdmin ? 'admin' : 'member')}
                  />
                </li>
              ))}
            </ul>

            {complaint.data.status === 'selesai' && (
              <p className="rounded-lg bg-accent2-200 px-4 py-3 text-base text-accent2-900">
                Aduan ini ditandai selesai. Kalau masih bermasalah, balas saja di bawah — statusnya
                otomatis terbuka lagi.
              </p>
            )}
          </>
        )}

        <div ref={endRef} />
      </div>

      <StickyBar>
        <form
          className="flex w-full items-center gap-2.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (invalid) return
            reply.mutate(text, { onSuccess: () => setText('') })
          }}
        >
          <label htmlFor="aduan-balas" className="sr-only">
            Tulis balasan
          </label>
          <input
            id="aduan-balas"
            value={text}
            maxLength={2_000}
            onChange={(e) => setText(e.target.value)}
            placeholder={isAdmin ? 'Balas sebagai klub…' : 'Tulis balasan…'}
            className="min-h-touch flex-1 rounded-pill bg-bg px-5 text-lg placeholder:text-neutral-600 focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Kirim"
            disabled={Boolean(invalid) || reply.isPending}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-accent text-bg disabled:opacity-45"
          >
            <Icon icon={Send} size={18} />
          </button>
        </form>
      </StickyBar>
    </div>
  )
}

function Header({ complaint }: { complaint: Complaint }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-lg bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="font-heading text-lg tracking-wide">{complaint.code}</span>
          <span className="text-sm text-neutral-600">
            {COMPLAINT_CATEGORY_LABEL[complaint.category]} · {complaint.userName}
          </span>
        </div>
        <Chip tone={COMPLAINT_STATUS_TONE[complaint.status]}>
          {COMPLAINT_STATUS_LABEL[complaint.status]}
        </Chip>
      </div>

      {complaint.relatedLabel && (
        <div className="flex items-baseline justify-between gap-3 rounded-md bg-bg px-3.5 py-2.5">
          <span className="text-sm text-neutral-600">
            {complaint.relatedKind === 'booking' ? 'Booking terkait' : 'Pesanan terkait'}
          </span>
          <span className="text-base font-semibold">{complaint.relatedLabel}</span>
        </div>
      )}

      <span className="text-sm text-neutral-600">Dibuat {formatDateLong(complaint.createdAt)}</span>
    </section>
  )
}

/** Kendali status hanya untuk admin; server menolak siapa pun yang lain. */
function AdminControls({
  current,
  busy,
  onChange,
}: {
  current: ComplaintStatus
  busy: boolean
  onChange: (status: ComplaintStatus) => void
}) {
  return (
    <section className="flex flex-col gap-2.5 rounded-lg bg-accent2-200 p-4">
      <h2 className="text-xl text-accent2-900">Kendali klub</h2>
      <div className="flex gap-2">
        {NEXT_STATUS.map((status) => (
          <button
            key={status}
            type="button"
            aria-pressed={current === status}
            disabled={busy || current === status}
            onClick={() => onChange(status)}
            className={clsx(
              'min-h-touch flex-1 rounded-pill px-4 text-base font-semibold transition-colors',
              current === status
                ? 'bg-accent2-700 text-accent2-100'
                : 'bg-bg text-text hover:bg-neutral-200',
              busy && 'opacity-60',
            )}
          >
            Tandai {COMPLAINT_STATUS_LABEL[status]}
          </button>
        ))}
      </div>
      <p className="text-sm text-accent2-800">
        Membalas juga memindahkan aduan baru ke Diproses — tombol ini untuk menutupnya.
      </p>
    </section>
  )
}

function Bubble({ message, mine }: { message: ComplaintMessage; mine: boolean }) {
  return (
    <div className={clsx('flex items-end gap-2.5', mine && 'flex-row-reverse')}>
      {!mine && (
        <Avatar
          name={message.authorName}
          size={32}
          tone={message.authorRole === 'admin' ? 'sage' : 'neutral'}
        />
      )}
      <div className={clsx('flex max-w-[76%] flex-col gap-1', mine && 'items-end')}>
        {!mine && <span className="px-1 text-sm text-neutral-600">{message.authorName}</span>}
        <div
          className={clsx(
            'whitespace-pre-wrap rounded-lg px-4 py-2.5 text-base',
            mine ? 'bg-accent text-bg' : 'bg-surface text-text',
          )}
        >
          {message.body}
        </div>
        <span className="px-1 text-sm text-neutral-600">{formatRelative(message.sentAt)}</span>
      </div>
    </div>
  )
}
