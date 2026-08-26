import { useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Users } from 'lucide-react'
import type { Booking } from '@/types'
import { SPORT_LABEL } from '@/types'
import { useBookings } from '@/hooks/queries'
import { paidAmount, paidRatio, splitTotal } from '@/lib/split'
import { formatDateShort, formatHourRange } from '@/lib/dates'
import { formatIdr } from '@/lib/money'
import { Screen, SectionHeading } from '@/components/layout/Screen'
import { LinkButton } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Chip, ProgressBar } from '@/components/ui/primitives'
import { AsyncList, EmptyState, ListSkeleton } from '@/components/ui/states'

type Tab = 'akan' | 'riwayat'

/** 09 · Booking saya. */
export function BookingsScreen() {
  const [tab, setTab] = useState<Tab>('akan')
  const bookings = useBookings()

  const now = Date.now()
  const rows = (bookings.data ?? []).filter((b) => {
    const upcoming = new Date(b.range.endsAt).getTime() >= now && b.status !== 'expired'
    return tab === 'akan' ? upcoming : !upcoming
  })

  return (
    <Screen>
      <SectionHeading title="Booking saya" />

      <div
        role="tablist"
        aria-label="Filter booking"
        className="flex gap-1 rounded-pill bg-surface p-1"
      >
        {(
          [
            ['akan', 'Akan datang'],
            ['riwayat', 'Riwayat'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={clsx(
              'min-h-touch flex-1 rounded-pill px-4 font-heading text-md',
              tab === value ? 'bg-accent text-bg' : 'text-neutral-700',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <AsyncList
        isLoading={bookings.isLoading}
        error={bookings.error}
        data={rows}
        onRetry={() => void bookings.refetch()}
        skeleton={<ListSkeleton count={3} />}
        empty={
          tab === 'akan' ? (
            <EmptyState
              title="Belum ada jadwal"
              body="Booking lapangan pertamamu, nanti muncul di sini lengkap dengan e-tiket."
              action={
                <LinkButton to="/search" size="md">
                  Cari lapangan
                </LinkButton>
              }
            />
          ) : (
            <EmptyState
              title="Riwayat masih kosong"
              body="Booking yang sudah lewat akan tersimpan di sini."
            />
          )
        }
      >
        {(items) => (
          <ul className="flex flex-col gap-3.5">
            {items.map((booking) => (
              <li key={booking.id}>
                <BookingCard booking={booking} past={tab === 'riwayat'} />
              </li>
            ))}
          </ul>
        )}
      </AsyncList>
    </Screen>
  )
}

const STATUS_LABEL: Record<Booking['status'], string> = {
  draft: 'Draft',
  summary: 'Belum dibayar',
  awaitingPayment: 'Menunggu pembayaran',
  confirmed: 'Terkonfirmasi',
  expired: 'Kedaluwarsa',
}

function BookingCard({ booking, past }: { booking: Booking; past: boolean }) {
  const split = booking.splitBill
  return (
    <article className="flex flex-col gap-3.5 rounded-lg bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="truncate text-xl">{booking.venueName}</h3>
          <p className="truncate text-base text-neutral-700">
            {SPORT_LABEL[booking.sport]} · {booking.courtName}
          </p>
        </div>
        <Chip
          tone={
            booking.status === 'confirmed'
              ? 'sage'
              : booking.status === 'expired'
                ? 'neutral'
                : 'accent'
          }
        >
          {STATUS_LABEL[booking.status]}
        </Chip>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-neutral-700">
        <span>{formatDateShort(booking.range.startsAt)}</span>
        <span>{formatHourRange(booking.range.startsAt, booking.range.endsAt)}</span>
        {booking.recurrence && <Chip tone="sage">Berulang {booking.recurrence.weeks} minggu</Chip>}
      </div>

      {split && split.participants.length > 1 && (
        <div className="flex flex-col gap-2 rounded-md bg-bg p-3.5">
          <div className="flex items-center gap-2 text-base">
            <Icon icon={Users} size={15} className="text-accent2-700" />
            <span className="flex-1 font-semibold">Split bill</span>
            <span className="text-sm text-neutral-700">
              {split.paidBy.length}/{split.participants.length} lunas
            </span>
          </div>
          <ProgressBar
            ratio={paidRatio(split)}
            tone="sage"
            label={`Terkumpul ${paidAmount(split)} dari ${splitTotal(split)}`}
          />
          <span className="text-sm text-neutral-700">
            {formatIdr(paidAmount(split))} dari {formatIdr(splitTotal(split))} terkumpul
          </span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <span className="flex-1 font-heading text-xl text-accent-700">
          {formatIdr(booking.totalIdr)}
        </span>
        {booking.status === 'confirmed' && !past && (
          <LinkButton to={`/booking/${booking.id}/ticket`} variant="secondary">
            Lihat e-tiket
          </LinkButton>
        )}
        {booking.status === 'confirmed' && past && (
          <Link
            to={`/venue/${booking.venueId}/reviews`}
            className="text-base font-semibold text-accent-700"
          >
            Tulis ulasan
          </Link>
        )}
      </div>
    </article>
  )
}
