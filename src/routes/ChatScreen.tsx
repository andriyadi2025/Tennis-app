import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import clsx from 'clsx'
import { Check, Send, Users } from 'lucide-react'
import type { ChatMessage, SplitBill } from '@/types'
import { queryKeys, useBooking, useChat, useSendMessage } from '@/hooks/queries'
import { useLiveChannel } from '@/hooks/useLiveChannel'
import { useAuthStore } from '@/store/auth'
import { useDraftStore } from '@/store/draft'
import { amountFor, paidAmount, paidRatio, splitTotal, togglePaid } from '@/lib/split'
import { formatRelative } from '@/lib/dates'
import { formatIdr } from '@/lib/money'
import { ScreenHeader, StickyBar } from '@/components/layout/Screen'
import { Icon } from '@/components/ui/Icon'
import { Avatar, ProgressBar } from '@/components/ui/primitives'
import { ErrorState, RowSkeleton } from '@/components/ui/states'

/** 18 · Obrolan grup main, dengan kartu split bill. */
export function ChatScreen() {
  const { id } = useParams<{ id: string }>()
  const chat = useChat(id)
  const send = useSendMessage(id)

  /*
   * Pesan orang lain masuk lewat SSE, bukan polling. Polling berarti memilih
   * antara boros permintaan atau pesan yang telat — dan obrolan yang telat
   * beberapa detik terasa rusak, bukan lambat.
   */
  useLiveChannel(id ? `/api/chats/${id}/stream` : null, [queryKeys.chat(id ?? '')])
  const me = useAuthStore((s) => s.user)
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [chat.data?.messages.length])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <div className="scroll-area flex flex-1 flex-col gap-5 px-5 pb-4 pt-5">
        <ScreenHeader title={chat.data?.title ?? 'Obrolan'} />

        {chat.data && <p className="-mt-3 text-base text-neutral-700">{chat.data.subtitle}</p>}

        {chat.isLoading ? (
          <RowSkeleton count={4} />
        ) : chat.error ? (
          <ErrorState body={chat.error.message} onRetry={() => void chat.refetch()} />
        ) : (
          <ul className="flex flex-col gap-3">
            {(chat.data?.messages ?? []).map((message) => (
              <li key={message.id}>
                {message.splitCardBookingId ? (
                  <SplitCard bookingId={message.splitCardBookingId} />
                ) : (
                  <Bubble message={message} mine={message.authorId === me?.id} />
                )}
              </li>
            ))}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      <StickyBar>
        <form
          className="flex w-full items-center gap-2.5"
          onSubmit={(e) => {
            e.preventDefault()
            const body = text.trim()
            if (!body) return
            send.mutate(body)
            setText('')
          }}
        >
          <label htmlFor="chat-input" className="sr-only">
            Tulis pesan
          </label>
          <input
            id="chat-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Tulis pesan…"
            className="min-h-touch flex-1 rounded-pill bg-bg px-5 text-lg placeholder:text-neutral-600 focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Kirim"
            disabled={!text.trim() || send.isPending}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-accent text-bg disabled:opacity-45"
          >
            <Icon icon={Send} size={18} />
          </button>
        </form>
      </StickyBar>
    </div>
  )
}

function Bubble({ message, mine }: { message: ChatMessage; mine: boolean }) {
  return (
    <div className={clsx('flex items-end gap-2.5', mine && 'flex-row-reverse')}>
      {!mine && <Avatar name={message.authorName} size={32} tone="neutral" />}
      <div className={clsx('flex max-w-[76%] flex-col gap-1', mine && 'items-end')}>
        {!mine && <span className="px-1 text-sm text-neutral-600">{message.authorName}</span>}
        <div
          className={clsx(
            'rounded-lg px-4 py-2.5 text-base',
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

/**
 * Kartu split bill di dalam obrolan. Booking bawaan seed tidak ada di server
 * mock (baru dibuat saat sesi berjalan), jadi kartu jatuh ke split bill yang
 * tersimpan di draft — dan tetap punya keadaan "belum ada" yang jujur.
 */
function SplitCard({ bookingId }: { bookingId: string }) {
  const booking = useBooking(bookingId)
  const draftSplit = useDraftStore((s) => s.splitBill)
  const setSplitBill = useDraftStore((s) => s.setSplitBill)

  const split: SplitBill | null = booking.data?.splitBill ?? draftSplit

  if (!split || split.participants.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border-2 border-dashed border-neutral-400 p-4">
        <div className="flex items-center gap-2.5">
          <Icon icon={Users} size={16} className="text-neutral-600" />
          <span className="text-base font-bold">Split bill</span>
        </div>
        <p className="text-base text-neutral-700">
          Belum ada split bill untuk sesi ini. Buat dari layar ringkasan booking.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-accent2-200 p-4">
      <div className="flex items-center gap-2.5">
        <Icon icon={Users} size={16} className="text-accent2-800" />
        <span className="flex-1 text-base font-bold text-accent2-900">Split bill</span>
        <span className="text-sm text-accent2-800">
          {split.paidBy.length}/{split.participants.length} lunas
        </span>
      </div>

      <ProgressBar
        ratio={paidRatio(split)}
        tone="sage"
        label={`Terkumpul ${paidAmount(split)} dari ${splitTotal(split)}`}
      />

      <ul className="flex flex-col gap-2">
        {split.participants.map((p) => {
          const paid = split.paidBy.includes(p.id)
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={paid}
                onClick={() => setSplitBill(togglePaid(split, p.id))}
                className="flex w-full min-h-touch items-center gap-2.5 rounded-md bg-bg px-3 py-2.5 text-left"
              >
                <Avatar name={p.name} size={30} tone={p.isHost ? 'accent' : 'neutral'} />
                <span className="flex-1 truncate text-base">{p.name}</span>
                <span className="font-heading text-base">{formatIdr(amountFor(split, p.id))}</span>
                <span
                  aria-hidden
                  className={clsx(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-pill',
                    paid ? 'bg-accent2-600 text-bg' : 'border-2 border-neutral-400',
                  )}
                >
                  {paid && <Icon icon={Check} size={13} />}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <p className="text-sm text-accent2-800">
        {formatIdr(paidAmount(split))} dari {formatIdr(splitTotal(split))} terkumpul. Ketuk nama
        untuk menandai lunas.
      </p>
    </div>
  )
}
