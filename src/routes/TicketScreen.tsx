import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { CalendarPlus, Copy, Share2 } from 'lucide-react'
import { PAYMENT_LABEL, SPORT_LABEL } from '@/types'
import { useBooking } from '@/hooks/queries'
import { useDraftStore } from '@/store/draft'
import { formatDateLong, formatHourRange } from '@/lib/dates'
import { formatIdr } from '@/lib/money'
import { Screen, ScreenHeader } from '@/components/layout/Screen'
import { Button, LinkButton } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Chip } from '@/components/ui/primitives'
import { ErrorState, SkeletonBlock } from '@/components/ui/states'

/** 08 · E-tiket QR. */
export function TicketScreen() {
  const { id } = useParams<{ id: string }>()
  const booking = useBooking(id)
  const resetDraft = useDraftStore((s) => s.reset)

  /*
   * Begitu tiket ada, draft sudah selesai tugasnya. Dibersihkan di sini —
   * bukan menunggu tombol tertentu ditekan — supaya draft berstatus
   * `confirmed` tidak tertinggal di localStorage dan bisa dikirim ulang
   * kalau user keluar lewat jalan lain.
   */
  useEffect(() => {
    if (booking.data?.status === 'confirmed') resetDraft()
  }, [booking.data?.status, resetDraft])

  if (booking.isLoading) {
    return (
      <Screen>
        <ScreenHeader title="E-tiket" />
        <SkeletonBlock className="h-[420px] w-full rounded-lg" />
      </Screen>
    )
  }

  if (booking.error || !booking.data) {
    return (
      <Screen>
        <ScreenHeader title="E-tiket" />
        <ErrorState
          body={booking.error?.message ?? 'Tiket tidak ditemukan.'}
          onRetry={() => void booking.refetch()}
        />
      </Screen>
    )
  }

  const data = booking.data

  return (
    <Screen>
      <ScreenHeader title="E-tiket" />

      <div className="flex flex-col gap-2">
        <Chip tone="sage" className="self-start">
          Booking terkonfirmasi
        </Chip>
        <p className="text-base text-neutral-700">
          Tunjukkan QR ini di meja resepsionis. Tiket tetap bisa dibuka tanpa internet.
        </p>
      </div>

      {/* Tiket dengan takik & garis putus */}
      <article className="overflow-hidden rounded-lg bg-surface">
        <div className="flex flex-col gap-1.5 px-5 pb-5 pt-6">
          <h2 className="text-3xl">{data.venueName}</h2>
          <p className="text-base text-neutral-700">
            {SPORT_LABEL[data.sport]} · {data.courtName}
          </p>
        </div>

        {/* Takik kiri-kanan + garis putus pemisah */}
        <div className="relative flex items-center" aria-hidden>
          <span className="-ml-3 h-6 w-6 shrink-0 rounded-pill bg-bg" />
          <span className="flex-1 border-t-2 border-dashed border-neutral-400" />
          <span className="-mr-3 h-6 w-6 shrink-0 rounded-pill bg-bg" />
        </div>

        <div className="flex flex-col items-center gap-4 px-5 py-6">
          <div className="rounded-md bg-neutral-100 p-4">
            {/* QR dibangkitkan dari kode booking — offline setelah termuat. */}
            <QRCodeSVG
              value={data.code}
              size={168}
              level="M"
              bgColor="transparent"
              fgColor="var(--color-text)"
              aria-label={`Kode QR untuk booking ${data.code}`}
            />
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-sm text-neutral-600">Kode booking</span>
            <span className="font-heading text-2xl tracking-wide">{data.code}</span>
          </div>
        </div>

        <div className="relative flex items-center" aria-hidden>
          <span className="-ml-3 h-6 w-6 shrink-0 rounded-pill bg-bg" />
          <span className="flex-1 border-t-2 border-dashed border-neutral-400" />
          <span className="-mr-3 h-6 w-6 shrink-0 rounded-pill bg-bg" />
        </div>

        <dl className="flex flex-col gap-2.5 px-5 pb-6 pt-5 text-base">
          <Row label="Tanggal" value={formatDateLong(data.range.startsAt)} />
          <Row label="Jam" value={formatHourRange(data.range.startsAt, data.range.endsAt)} />
          <Row label="Durasi" value={`${data.range.hours} jam`} />
          {data.recurrence && (
            <Row label="Berulang" value={`Mingguan · ${data.recurrence.weeks} minggu`} />
          )}
          <Row
            label="Dibayar"
            value={
              data.paymentMethod
                ? `${formatIdr(data.totalIdr)} · ${PAYMENT_LABEL[data.paymentMethod]}`
                : formatIdr(data.totalIdr)
            }
          />
        </dl>
      </article>

      <div className="flex gap-3">
        <Button variant="secondary" block>
          <Icon icon={Share2} size={16} />
          Bagikan
        </Button>
        <Button variant="secondary" block>
          <Icon icon={CalendarPlus} size={16} />
          Kalender
        </Button>
      </div>

      <Button
        variant="ghost"
        block
        onClick={() => {
          void navigator.clipboard?.writeText(data.code)
        }}
      >
        <Icon icon={Copy} size={16} />
        Salin kode booking
      </Button>

      <LinkButton to="/bookings" size="lg" block>
        Lihat booking saya
      </LinkButton>
    </Screen>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-neutral-700">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  )
}
