import { useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { ExternalLink } from 'lucide-react'
import type { Payment } from '@/hooks/queries'
import { queryKeys, usePayment, useSimulatePayment } from '@/hooks/queries'
import { useLiveChannel } from '@/hooks/useLiveChannel'
import { formatIdr } from '@/lib/money'
import { Screen, ScreenHeader, StickyBar } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Chip } from '@/components/ui/primitives'

/**
 * Menunggu pembayaran masuk.
 *
 * Layar ini tidak pernah menyatakan lunas sendiri. Ia menunggu server
 * mengatakannya — lewat SSE, dengan pengambilan ulang sebagai penyangga —
 * karena yang membuktikan uang berpindah cuma webhook penyedia.
 *
 * Saat penyedia sungguhan belum dikonfigurasi, layarnya **mengatakannya**
 * dan menyediakan tombol simulasi. Tombol itu tidak memalsukan status: ia
 * meminta server merakit webhook bertanda tangan dan mengirimkannya ke
 * endpoint yang sama dengan yang dipakai produksi.
 */
export function PaymentPending({
  payment: initial,
  title,
  onSettled,
  onCancel,
}: {
  payment: Payment
  title: string
  onSettled: () => void
  onCancel: () => void
}) {
  const payment = usePayment(initial.id)
  const simulate = useSimulatePayment(initial.id)
  const current = payment.data ?? initial

  useLiveChannel(`/api/payments/${initial.id}/stream`, [queryKeys.payment(initial.id)])

  useEffect(() => {
    if (current.status === 'settled') onSettled()
    // `onSettled` sengaja bukan dependensi: pemanggil membuatnya inline, jadi
    // ia beda referensi tiap render dan efek ini akan berjalan terus-menerus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.status])

  const simulator = current.provider === 'simulator'
  const gagal = current.status === 'expired' || current.status === 'failed'

  return (
    <Screen
      bottom={
        <StickyBar>
          <Button variant="secondary" block onClick={onCancel}>
            {gagal ? 'Kembali' : 'Batal'}
          </Button>
          {simulator && !gagal && (
            <Button block disabled={simulate.isPending} onClick={() => simulate.mutate('settled')}>
              {simulate.isPending ? 'Memproses…' : 'Tandai lunas (simulasi)'}
            </Button>
          )}
        </StickyBar>
      }
    >
      <ScreenHeader title={title} onBack={onCancel} />

      <div className="flex flex-col items-center gap-2 rounded-lg bg-surface px-5 py-6">
        <span className="text-sm text-neutral-600">Jumlah yang harus dibayar</span>
        <span className="font-heading text-3xl text-accent-700">
          {formatIdr(current.amountIdr)}
        </span>
        <Chip tone={gagal ? 'accent' : current.status === 'settled' ? 'sage' : 'neutral'}>
          {current.status === 'settled'
            ? 'Lunas'
            : current.status === 'pending'
              ? 'Menunggu pembayaran'
              : current.status === 'expired'
                ? 'Kedaluwarsa'
                : 'Gagal'}
        </Chip>
      </div>

      {simulator && (
        <div role="alert" className="flex flex-col gap-2 rounded-lg bg-accent-100 p-4">
          <h2 className="text-xl text-accent-900">Belum ada gerbang pembayaran</h2>
          <p className="text-base text-accent-800">
            Server ini memakai simulator — tidak ada uang yang benar-benar berpindah. Isi{' '}
            <code className="font-mono text-sm">MIDTRANS_SERVER_KEY</code> dan{' '}
            <code className="font-mono text-sm">MIDTRANS_CLIENT_KEY</code> untuk memakai gerbang
            sungguhan.
          </p>
        </div>
      )}

      {current.qrString && !gagal && (
        <div className="flex flex-col items-center gap-3 rounded-lg bg-surface p-5">
          <QRCodeSVG value={current.qrString} size={168} level="M" />
          <p className="max-w-[30ch] text-center text-sm text-neutral-600">
            {simulator
              ? 'QR ini isinya penanda simulasi, bukan QRIS yang bisa dipindai aplikasi bank.'
              : 'Pindai dengan aplikasi bank atau e-wallet yang mendukung QRIS.'}
          </p>
        </div>
      )}

      {current.redirectUrl && !gagal && (
        <a
          href={current.redirectUrl}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-touch items-center justify-center gap-2 rounded-pill bg-accent px-6 font-heading text-lg text-bg"
        >
          <Icon icon={ExternalLink} size={18} />
          Buka halaman pembayaran
        </a>
      )}

      {gagal && (
        <p role="alert" className="text-base text-accent-700">
          Pembayaran tidak selesai. Slot yang tadi ditahan sudah dilepas — silakan pilih jam lagi.
        </p>
      )}

      <p className="text-sm text-neutral-600">
        Halaman ini menunggu kabar dari server. Booking baru dikonfirmasi setelah pembayarannya
        benar-benar masuk — kembali dari halaman pembayaran saja tidak cukup.
      </p>
    </Screen>
  )
}
