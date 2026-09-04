import { Link } from 'react-router-dom'
import type { MerchOrder, MerchOrderStatus } from '@/types'
import { MERCH_STATUS_LABEL } from '@/types'
import { useCancelMerchOrder, useMerchOrders } from '@/hooks/queries'
import { useToast } from '@/hooks/useToast'
import { formatIdr } from '@/lib/money'
import { formatDateShort, formatRelative } from '@/lib/dates'
import { Screen, ScreenHeader } from '@/components/layout/Screen'
import { Button, LinkButton } from '@/components/ui/Button'
import { Toast } from '@/components/ui/Toast'
import { Chip } from '@/components/ui/primitives'
import { AsyncList, EmptyState, RowSkeleton } from '@/components/ui/states'

const STATUS_TONE: Record<MerchOrderStatus, 'accent' | 'sage' | 'neutral' | 'outline'> = {
  menunggu: 'outline',
  disiapkan: 'neutral',
  siapDiambil: 'sage',
  selesai: 'sage',
  batal: 'accent',
}

/** Pesanan toko milik user, beserta kode ambilnya. */
export function ShopOrdersScreen() {
  const orders = useMerchOrders()
  const cancel = useCancelMerchOrder()
  const { toast, show } = useToast()

  return (
    <Screen overlay={<Toast toast={toast} />}>
      <ScreenHeader title="Pesanan toko" />

      <AsyncList
        isLoading={orders.isLoading}
        error={orders.error}
        data={orders.data}
        onRetry={() => void orders.refetch()}
        skeleton={<RowSkeleton count={3} />}
        empty={
          <EmptyState
            title="Belum ada pesanan"
            body="Barang klub bisa dibeli atau ditukar dengan poin dari halaman toko."
            action={<LinkButton to="/toko">Buka toko</LinkButton>}
          />
        }
      >
        {(rows) => (
          <ul className="flex flex-col gap-2.5">
            {rows.map((order) => (
              <li key={order.id}>
                <OrderCard
                  order={order}
                  busy={cancel.isPending}
                  onCancel={() =>
                    cancel.mutate(order.id, {
                      onSuccess: () => show('Pesanan dibatalkan. Poin dan stok dikembalikan.'),
                      onError: (error) => show(error.message),
                    })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </AsyncList>

      <p className="text-sm text-neutral-600">
        Tunjukkan kode pesanan ke petugas klub saat mengambil barang. Ada masalah dengan pesanan?{' '}
        <Link to="/bantuan/baru" className="font-semibold text-accent-700 underline">
          Kirim aduan
        </Link>
        .
      </p>
    </Screen>
  )
}

function OrderCard({
  order,
  busy,
  onCancel,
}: {
  order: MerchOrder
  busy: boolean
  onCancel: () => void
}) {
  // Hanya pesanan yang belum disiapkan yang boleh dibatalkan sendiri; sisanya
  // sudah menyangkut kerja orang lain di klub.
  const bisaBatal = order.status === 'menunggu'

  return (
    <article className="flex flex-col gap-3 rounded-lg bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-1 flex-col gap-0.5">
          <h3 className="text-md font-bold leading-snug">{order.itemName}</h3>
          <span className="text-sm text-neutral-700">
            {order.variantLabel} · {order.qty} pcs · {formatDateShort(order.createdAt)}
          </span>
        </div>
        <Chip tone={STATUS_TONE[order.status]}>{MERCH_STATUS_LABEL[order.status]}</Chip>
      </div>

      <div className="flex items-baseline justify-between gap-3 rounded-md bg-bg px-3.5 py-2.5">
        <span className="text-sm text-neutral-600">Kode ambil</span>
        <span className="font-heading text-lg tracking-wide">{order.code}</span>
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <span className="text-base text-neutral-700">
          {order.payMode === 'poin' ? 'Ditukar poin' : 'Dibayar'}
        </span>
        <span className="font-heading text-lg">
          {order.payMode === 'poin'
            ? `${order.pointsSpent.toLocaleString('id-ID')} poin`
            : formatIdr(order.totalIdr)}
        </span>
      </div>

      {order.status === 'batal' && (
        <p className="text-sm text-neutral-600">
          {order.payMode === 'poin'
            ? `${order.pointsSpent.toLocaleString('id-ID')} poin sudah dikembalikan.`
            : 'Stok sudah dikembalikan ke katalog.'}
        </p>
      )}

      {bisaBatal && (
        <div className="flex items-center gap-3">
          <span className="flex-1 text-sm text-neutral-600">
            Dibuat {formatRelative(order.createdAt)}
          </span>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Batalkan
          </Button>
        </div>
      )}
    </article>
  )
}
