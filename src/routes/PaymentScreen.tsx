import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Banknote, Building2, CreditCard, QrCode, Smartphone } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { PaymentMethod } from '@/types'
import { PAYMENT_LABEL } from '@/types'
import { useBooking, usePayBooking } from '@/hooks/queries'
import { useDraftStore } from '@/store/draft'
import { useAuthStore } from '@/store/auth'
import { pointsEarned } from '@/lib/points'
import { formatCountdown, formatDateShort, formatHourRange } from '@/lib/dates'
import { formatIdr } from '@/lib/money'
import { Screen, ScreenHeader, StickyBar } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { ErrorState, SkeletonBlock } from '@/components/ui/states'

const METHODS: { id: PaymentMethod; icon: LucideIcon; note: string }[] = [
  { id: 'qris', icon: QrCode, note: 'Scan pakai app bank atau e-wallet apa pun' },
  { id: 'ewallet', icon: Smartphone, note: 'GoPay, OVO, DANA, ShopeePay' },
  { id: 'va', icon: Building2, note: 'BCA, Mandiri, BNI, BRI' },
  { id: 'card', icon: CreditCard, note: 'Visa, Mastercard' },
  { id: 'onsite', icon: Banknote, note: 'Bayar tunai saat datang — slot tetap dikunci' },
]

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
  const adjustPoints = useAuthStore((s) => s.adjustPoints)
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
          adjustPoints(
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
        <fieldset className="flex flex-col gap-2.5" disabled={expired}>
          <legend className="sr-only">Pilih metode pembayaran</legend>
          {METHODS.map(({ id, icon, note }) => {
            const active = method === id
            return (
              <label
                key={id}
                className={clsx(
                  'flex min-h-touch cursor-pointer items-center gap-3.5 rounded-lg px-4 py-3.5 transition-colors',
                  active ? 'bg-accent-100 ring-2 ring-accent' : 'bg-surface',
                  expired && 'opacity-50',
                )}
              >
                <input
                  type="radio"
                  name="payment-method"
                  value={id}
                  checked={active}
                  onChange={() => setMethod(id)}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className={clsx(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-pill',
                    active ? 'bg-accent text-bg' : 'bg-neutral-200 text-neutral-800',
                  )}
                >
                  <Icon icon={icon} size={20} />
                </span>
                <span className="flex flex-1 flex-col">
                  <span className="text-md font-bold">{PAYMENT_LABEL[id]}</span>
                  <span className="text-sm text-neutral-700">{note}</span>
                </span>
                <span
                  aria-hidden
                  className={clsx(
                    'h-5 w-5 shrink-0 rounded-pill border-2',
                    active
                      ? 'border-accent bg-accent ring-4 ring-inset ring-bg'
                      : 'border-neutral-400',
                  )}
                />
              </label>
            )
          })}
        </fieldset>
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
