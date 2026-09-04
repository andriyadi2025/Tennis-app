import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { QrCode } from 'lucide-react'
import type { PaymentMethod } from '@/types'
import { PAYMENT_LABEL } from '@/types'
import { useAdjustPoints, useBooking, usePayBooking } from '@/hooks/queries'
import { useDraftStore } from '@/store/draft'
import { pointsEarned } from '@/lib/points'
import { formatCountdown, formatDateShort, formatHourRange } from '@/lib/dates'
import { formatIdr } from '@/lib/money'
import { Screen, ScreenHeader, StickyBar } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { ErrorState, SkeletonBlock } from '@/components/ui/states'
import { PaymentMethodPicker } from '@/components/domain/PaymentMethodPicker'

/**
 * Hitung mundur hold pembayaran. Sumber kebenarannya deadline dari server,
 * bukan angka yang dihitung sendiri di klien — jadi refresh halaman tidak
 * mereset waktu.
 */
function useCountdown(deadlineIso: string | null): number {
  const [remaining, setRemaining] = useState(() =>
    deadlineIso ? new Date(deadlineIso).getTime() - Date.now() : 0,
  )

  useEffect(() => {
    if (!deadlineIso) return
    const tick = () => setRemaining(new Date(deadlineIso).getTime() - Date.now())
    tick()
    const timer = window.setInterval(tick, 1_000)
    return () => window.clearInterval(timer)
  }, [deadlineIso])

  return remaining
}

/** 07 · Pembayaran. */
export function PaymentScreen() {
  const navigate = useNavigate()
  const draft = useDraftStore()
  const adjustPoints = useAdjustPoints()
  const booking = useBooking(draft.bookingId ?? undefined)
  const pay = usePayBooking()

  const [method, setMethod] = useState<PaymentMethod>('qris')
  const remaining = useCountdown(booking.data?.paymentDeadline ?? draft.paymentDeadline)
  const expired = remaining <= 0

  // Hold habis → booking tidak bisa dibayar lagi, draft dikembalikan.
  useEffect(() => {
    if (expired && draft.stage === 'awaitingPayment') draft.expire()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired])

  if (!draft.bookingId) return <Navigate to="/" replace />

  function onPay() {
    const id = draft.bookingId
    if (!id || !draft.canPay()) return
    pay.mutate(
      { id, method },
      {
        onSuccess: (confirmed) => {
          draft.confirm()
          // Poin yang ditukar berkurang, poin dari transaksi bertambah.
          adjustPoints.mutate(
            pointsEarned(confirmed.subtotalIdr - confirmed.discountIdr) - confirmed.pointsRedeemed,
          )
          navigate(`/booking/${confirmed.id}/ticket`, { replace: true })
        },
      },
    )
  }

  const data = booking.data

  return (
    <Screen
      bottom={
        <StickyBar>
          <div className="flex flex-col">
            <span className="text-sm text-neutral-700">Total</span>
            <span className="font-heading text-2xl text-accent-700">
              {data ? formatIdr(data.totalIdr) : '—'}
            </span>
          </div>
          <Button
            size="lg"
            className="flex-1"
            disabled={expired || pay.isPending || !data}
            onClick={onPay}
          >
            {pay.isPending ? 'Memproses…' : `Bayar ${PAYMENT_LABEL[method]}`}
          </Button>
        </StickyBar>
      }
    >
      <ScreenHeader title="Pembayaran" />

      {/* Countdown hold */}
      <div
        aria-live="polite"
        className={clsx(
          'flex items-center justify-between gap-4 rounded-lg px-5 py-4',
          expired ? 'bg-accent-100' : 'bg-accent2-200',
        )}
      >
        <div className="flex flex-col">
          <span className={clsx('text-base', expired ? 'text-accent-800' : 'text-accent2-800')}>
            {expired ? 'Waktu pembayaran habis' : 'Selesaikan dalam'}
          </span>
          <span
            className={clsx(
              'font-heading text-4xl tabular-nums',
              expired ? 'text-accent-900' : 'text-accent2-900',
            )}
          >
            {formatCountdown(remaining)}
          </span>
        </div>
        <span className="max-w-[14ch] text-right text-sm text-neutral-700">
          {expired ? 'Slot sudah dilepas kembali.' : 'Slot dikunci sementara untuk kamu.'}
        </span>
      </div>

      {expired && (
        <ErrorState
          title="Hold berakhir"
          body="Slot dilepas kembali ke publik. Pilih jam lagi untuk melanjutkan."
          onRetry={() => navigate(`/venue/${draft.venueId}/schedule`)}
        />
      )}

      {pay.error && (
        <ErrorState
          title={pay.error.message.includes('diambil') ? 'Slot keburu diambil' : 'Pembayaran gagal'}
          body={pay.error.message}
          onRetry={() =>
            pay.error.message.includes('diambil')
              ? navigate(`/venue/${draft.venueId}/schedule`)
              : onPay()
          }
        />
      )}

      {/* Ringkas booking */}
      {booking.isLoading ? (
        <SkeletonBlock className="h-24 w-full rounded-lg" />
      ) : data ? (
        <section className="flex flex-col gap-1.5 rounded-lg bg-surface p-4">
          <h2 className="text-xl">{data.venueName}</h2>
          <p className="text-base text-neutral-700">
            {data.courtName} · {formatDateShort(data.range.startsAt)} ·{' '}
            {formatHourRange(data.range.startsAt, data.range.endsAt)}
          </p>
          {data.recurrence && (
            <p className="text-base text-accent2-700">
              Berulang mingguan · {data.recurrence.weeks} minggu
            </p>
          )}
        </section>
      ) : null}

      {/* Metode pembayaran */}
      <section className="flex flex-col gap-3">
        <h2 className="text-3xl">Metode pembayaran</h2>
        <PaymentMethodPicker
          name="booking-payment"
          value={method}
          onChange={setMethod}
          disabled={expired}
        />
      </section>

      {method === 'qris' && !expired && (
        <div className="flex flex-col items-center gap-3 rounded-lg bg-surface p-5">
          <span
            aria-hidden
            className="flex h-32 w-32 items-center justify-center rounded-md bg-neutral-200 text-neutral-600"
          >
            <Icon icon={QrCode} size={64} />
          </span>
          <p className="text-center text-base text-neutral-700">
            Kode QRIS muncul setelah kamu menekan Bayar.
          </p>
        </div>
      )}
    </Screen>
  )
}
