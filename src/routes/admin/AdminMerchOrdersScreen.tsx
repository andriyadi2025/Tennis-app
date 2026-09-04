import { useState } from 'react'
import clsx from 'clsx'
import type { MerchOrder, MerchOrderStatus } from '@/types'
import { MERCH_STATUS_LABEL, PAYMENT_LABEL } from '@/types'
import { useAdminMerchOrders, useSetMerchOrderStatus } from '@/hooks/queries'
import { useToast } from '@/hooks/useToast'
import { formatIdr } from '@/lib/money'
import { formatDateShort } from '@/lib/dates'
import { Screen, ScreenHeader } from '@/components/layout/Screen'
import { Toast } from '@/components/ui/Toast'
import { Chip } from '@/components/ui/primitives'
import { AsyncList, EmptyState, RowSkeleton } from '@/components/ui/states'

/**
 * Langkah berikutnya untuk tiap status. Pembatalan sengaja tidak ditawarkan
 * setelah barang diambil — status `selesai` menyatakan barangnya sudah
 * berpindah tangan, dan membatalkannya cuma akan membohongi stok.
 */
const NEXT: Record<MerchOrderStatus, MerchOrderStatus[]> = {
  menunggu: ['disiapkan', 'batal'],
  disiapkan: ['siapDiambil', 'batal'],
  siapDiambil: ['selesai', 'batal'],
  selesai: [],
  batal: [],
}

const TABS: { value: MerchOrderStatus | 'aktif'; label: string }[] = [
  { value: 'aktif', label: 'Perlu diproses' },
  { value: 'menunggu', label: MERCH_STATUS_LABEL.menunggu },
  { value: 'disiapkan', label: MERCH_STATUS_LABEL.disiapkan },
  { value: 'siapDiambil', label: MERCH_STATUS_LABEL.siapDiambil },
  { value: 'selesai', label: MERCH_STATUS_LABEL.selesai },
  { value: 'batal', label: MERCH_STATUS_LABEL.batal },
]

const ACTIVE: MerchOrderStatus[] = ['menunggu', 'disiapkan', 'siapDiambil']

/** Pesanan toko yang masuk, beserta perpindahan statusnya. */
export function AdminMerchOrdersScreen() {
  const [tab, setTab] = useState<MerchOrderStatus | 'aktif'>('aktif')
  const orders = useAdminMerchOrders()
  const setStatus = useSetMerchOrderStatus()
  const { toast, show } = useToast()

  const rows = (orders.data ?? []).filter((o) =>
    tab === 'aktif' ? ACTIVE.includes(o.status) : o.status === tab,
  )

  return (
    <Screen overlay={<Toast toast={toast} />}>
      <ScreenHeader title="Pesanan toko" />

      <div className="row-scroll -mx-5 flex gap-2 px-5" role="tablist" aria-label="Saring pesanan">
        {TABS.map(({ value, label }) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={clsx(
              'min-h-touch shrink-0 rounded-pill px-4 text-base font-semibold transition-colors',
              tab === value
                ? 'bg-accent2-600 text-accent2-100'
                : 'border border-divider text-text hover:bg-neutral-200',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <AsyncList
        isLoading={orders.isLoading}
        error={orders.error}
        data={rows}
        onRetry={() => void orders.refetch()}
        skeleton={<RowSkeleton count={3} />}
        empty={
          <EmptyState
            title="Tidak ada pesanan di sini"
            body={
              tab === 'aktif'
                ? 'Semua pesanan sudah selesai diproses.'
                : 'Belum ada pesanan dengan status ini.'
            }
          />
        }
      >
        {(list) => (
          <ul className="flex flex-col gap-2.5">
            {list.map((order) => (
              <li key={order.id}>
                <OrderRow
                  order={order}
                  busy={setStatus.isPending}
                  onMove={(status) =>
                    setStatus.mutate(
                      { id: order.id, status },
                      {
                        onSuccess: () =>
                          show(
                            status === 'batal'
                              ? `${order.code} dibatalkan. Stok dan poin dikembalikan.`
                              : `${order.code} → ${MERCH_STATUS_LABEL[status]}.`,
                          ),
                        onError: (error) => show(error.message),
                      },
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </AsyncList>

      <p className="text-sm text-neutral-600">
        Membatalkan pesanan mengembalikan stok ke katalog dan poin ke saldo anggota.
      </p>
    </Screen>
  )
}

function OrderRow({
  order,
  busy,
  onMove,
}: {
  order: MerchOrder
  busy: boolean
  onMove: (status: MerchOrderStatus) => void
}) {
  const next = NEXT[order.status]

  return (
    <article className="flex flex-col gap-3 rounded-lg bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="font-heading text-lg tracking-wide">{order.code}</span>
          <span className="text-md font-bold leading-snug">{order.itemName}</span>
          <span className="text-sm text-neutral-700">
            {order.variantLabel} · {order.qty} pcs · {formatDateShort(order.createdAt)}
          </span>
        </div>
        <Chip tone={order.status === 'batal' ? 'accent' : 'neutral'}>
          {MERCH_STATUS_LABEL[order.status]}
        </Chip>
      </div>

      <div className="flex items-baseline justify-between gap-3 rounded-md bg-bg px-3.5 py-2.5">
        <span className="text-sm text-neutral-600">
          {order.payMode === 'poin'
            ? 'Tukar poin'
            : `Bayar · ${PAYMENT_LABEL[order.paymentMethod ?? 'qris']}`}
        </span>
        <span className="font-heading text-lg">
          {order.payMode === 'poin'
            ? `${order.pointsSpent.toLocaleString('id-ID')} poin`
            : formatIdr(order.totalIdr)}
        </span>
      </div>

      {next.length > 0 && (
        <div className="flex gap-2">
          {next.map((status) => (
            <button
              key={status}
              type="button"
              disabled={busy}
              onClick={() => onMove(status)}
              className={clsx(
                'min-h-touch flex-1 rounded-pill px-4 text-base font-semibold transition-colors',
                status === 'batal'
                  ? 'border border-divider text-accent-700 hover:bg-accent-100'
                  : 'bg-accent2-600 text-accent2-100 hover:bg-accent2-700',
                busy && 'opacity-60',
              )}
            >
              {status === 'batal' ? 'Batalkan' : MERCH_STATUS_LABEL[status]}
            </button>
          ))}
        </div>
      )}
    </article>
  )
}
