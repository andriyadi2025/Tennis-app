import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { Minus, Plus } from 'lucide-react'
import type { MerchItem, MerchPayMode, PaymentMethod, User } from '@/types'
import { MERCH_CATEGORY_LABEL } from '@/types'
import { useMe, useMerchItem, useOrderMerch } from '@/hooks/queries'
import { useToast } from '@/hooks/useToast'
import {
  MAX_QTY_PER_ORDER,
  findVariant,
  orderBlocker,
  payModesFor,
  quoteOrder,
  totalStock,
} from '@/lib/merch'
import { formatIdr } from '@/lib/money'
import { Screen, ScreenHeader, StickyBar } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Toast } from '@/components/ui/Toast'
import { Chip, VenuePhoto } from '@/components/ui/primitives'
import { ErrorState, SkeletonBlock } from '@/components/ui/states'
import { PaymentMethodPicker } from '@/components/domain/PaymentMethodPicker'

/** Detail barang toko: varian, jumlah, lalu lembar pemesanan. */
export function ShopItemScreen() {
  const { id } = useParams<{ id: string }>()
  const item = useMerchItem(id)
  const profile = useMe()
  const [variantId, setVariantId] = useState('')
  const [qty, setQty] = useState(1)
  const [sheet, setSheet] = useState(false)
  const { toast, show } = useToast()

  if (item.isLoading || profile.isLoading) {
    return (
      <Screen>
        <ScreenHeader title="Barang" />
        <SkeletonBlock className="aspect-square w-full rounded-lg" />
        <SkeletonBlock className="h-6 w-2/3 rounded-pill" />
        <SkeletonBlock className="h-20 w-full rounded-lg" />
      </Screen>
    )
  }

  if (item.error || !item.data || !profile.data) {
    return (
      <Screen>
        <ScreenHeader title="Barang" />
        <ErrorState
          body={item.error?.message ?? 'Barang tidak ditemukan.'}
          onRetry={() => void item.refetch()}
        />
      </Screen>
    )
  }

  const barang = item.data
  const me = profile.data
  const variant = findVariant(barang, variantId)
  const modes = payModesFor(barang)

  // Dipanggil dengan varian yang sedang dipilih supaya pesannya menyebut
  // ukuran yang benar, bukan menebak varian pertama.
  const blocker = orderBlocker({
    item: barang,
    variantId,
    qty,
    payMode: modes[0] ?? 'uang',
    user: me,
  })
  const maxQty = Math.min(MAX_QTY_PER_ORDER, variant?.stock ?? MAX_QTY_PER_ORDER)

  return (
    <Screen
      overlay={<Toast toast={toast} />}
      bottom={
        <StickyBar>
          <Button
            size="lg"
            block
            disabled={Boolean(blocker)}
            onClick={() => setSheet(true)}
            title={blocker ?? undefined}
          >
            {blocker ?? 'Pesan sekarang'}
          </Button>
        </StickyBar>
      }
    >
      <ScreenHeader title={barang.name} />

      <VenuePhoto photo={barang.photo} className="aspect-square w-full" rounded="rounded-lg" />

      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap gap-2">
          <Chip tone="neutral">{MERCH_CATEGORY_LABEL[barang.category]}</Chip>
          {barang.membersOnly && <Chip tone="sage">Khusus anggota</Chip>}
          <Chip tone={totalStock(barang) > 0 ? 'outline' : 'accent'}>
            {totalStock(barang) > 0 ? `Stok ${totalStock(barang)}` : 'Habis'}
          </Chip>
        </div>

        <h1 className="text-3xl">{barang.name}</h1>
        <p className="text-base text-neutral-700">{barang.description}</p>
      </div>

      <PriceBoard item={barang} />

      <section className="flex flex-col gap-2.5">
        <h2 className="text-xl">Pilih varian</h2>
        <div className="flex flex-wrap gap-2">
          {barang.variants.map((v) => {
            const habis = v.stock <= 0
            const active = v.id === variantId
            return (
              <button
                key={v.id}
                type="button"
                aria-pressed={active}
                disabled={habis}
                onClick={() => {
                  setVariantId(v.id)
                  // Jumlah lama bisa melebihi stok varian baru.
                  setQty((n) => Math.min(n, Math.min(MAX_QTY_PER_ORDER, v.stock)))
                }}
                className={clsx(
                  'min-h-touch rounded-pill px-4 text-base font-semibold transition-colors',
                  active
                    ? 'bg-accent2-600 text-accent2-100'
                    : 'border border-divider text-text hover:bg-neutral-200',
                  habis && 'opacity-45 line-through',
                )}
              >
                {v.label}
                {!habis && v.stock <= 3 && (
                  <span className="ml-1.5 text-sm font-normal">sisa {v.stock}</span>
                )}
              </button>
            )
          })}
        </div>
      </section>

      <section className="flex items-center gap-4">
        <h2 className="flex-1 text-xl">Jumlah</h2>
        <div className="flex items-center gap-2">
          <StepButton
            label="Kurangi"
            icon={Minus}
            disabled={qty <= 1}
            onClick={() => setQty((n) => Math.max(1, n - 1))}
          />
          <span className="w-8 text-center font-heading text-xl tabular-nums">{qty}</span>
          <StepButton
            label="Tambah"
            icon={Plus}
            disabled={qty >= maxQty || !variant}
            onClick={() => setQty((n) => Math.min(maxQty, n + 1))}
          />
        </div>
      </section>

      <p className="text-sm text-neutral-600">
        Maksimal {MAX_QTY_PER_ORDER} per pesanan. Barang diambil di klub, tidak dikirim.
      </p>

      {sheet && variant && (
        <OrderSheet
          item={barang}
          variantId={variantId}
          qty={qty}
          me={me}
          modes={modes}
          onClose={() => setSheet(false)}
          onDone={(message) => {
            setSheet(false)
            show(message)
          }}
          onFailed={(message) => {
            setSheet(false)
            show(message)
          }}
        />
      )}
    </Screen>
  )
}

function StepButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string
  icon: typeof Plus
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded-pill bg-surface disabled:opacity-40"
    >
      <Icon icon={icon} size={17} />
    </button>
  )
}

/** Dua harga berdampingan, supaya pilihannya terlihat sebelum diketuk. */
function PriceBoard({ item }: { item: MerchItem }) {
  return (
    <dl className="flex gap-3">
      {item.priceIdr !== null && (
        <div className="flex flex-1 flex-col gap-0.5 rounded-lg bg-surface px-4 py-3">
          <dt className="text-sm text-neutral-600">Harga beli</dt>
          <dd className="font-heading text-xl text-accent-700">{formatIdr(item.priceIdr)}</dd>
        </div>
      )}
      {item.pricePoints !== null && (
        <div className="flex flex-1 flex-col gap-0.5 rounded-lg bg-accent2-200 px-4 py-3">
          <dt className="text-sm text-accent2-800">Tukar poin</dt>
          <dd className="font-heading text-xl text-accent2-900">
            {item.pricePoints.toLocaleString('id-ID')}
          </dd>
        </div>
      )}
    </dl>
  )
}

/**
 * Lembar pemesanan. Cara bayar dipilih di sini, bukan di layar sebelumnya,
 * supaya orang membandingkan harga rupiah dan harga poin persis saat memutuskan
 * — dan langsung melihat sisa saldonya setelah ditebus.
 */
function OrderSheet({
  item,
  variantId,
  qty,
  me,
  modes,
  onClose,
  onDone,
  onFailed,
}: {
  item: MerchItem
  variantId: string
  qty: number
  me: User
  modes: MerchPayMode[]
  onClose: () => void
  onDone: (message: string) => void
  onFailed: (message: string) => void
}) {
  const navigate = useNavigate()
  const [payMode, setPayMode] = useState<MerchPayMode>(modes[0] ?? 'uang')
  const [method, setMethod] = useState<PaymentMethod>('qris')
  const order = useOrderMerch(item.id)

  const quote = quoteOrder(item, qty, payMode)
  const blocker = orderBlocker({ item, variantId, qty, payMode, user: me })
  const variantLabel = findVariant(item, variantId)?.label ?? ''

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Pesan ${item.name}`}
      className="sheet-backdrop absolute inset-0 z-20 flex flex-col justify-end"
    >
      <button
        type="button"
        aria-label="Tutup"
        className="flex-1 cursor-default"
        onClick={onClose}
      />

      <div className="scroll-area flex max-h-[86%] flex-col gap-5 rounded-t-lg bg-bg px-5 pb-5 pt-6">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-3xl">Pesan barang</h2>
          <p className="text-base text-neutral-700">
            {item.name} · {variantLabel} · {qty} pcs
          </p>
        </div>

        {modes.length > 1 && (
          <div className="flex flex-col gap-2.5">
            <h3 className="text-xl">Cara bayar</h3>
            <div className="flex gap-2.5">
              <ModeButton
                active={payMode === 'uang'}
                onClick={() => setPayMode('uang')}
                title="Bayar"
                detail={formatIdr((item.priceIdr ?? 0) * qty)}
              />
              <ModeButton
                active={payMode === 'poin'}
                onClick={() => setPayMode('poin')}
                title="Tukar poin"
                detail={`${((item.pricePoints ?? 0) * qty).toLocaleString('id-ID')} poin`}
              />
            </div>
          </div>
        )}

        <dl className="flex flex-col gap-2.5 rounded-lg bg-surface p-4 text-base">
          {payMode === 'uang' ? (
            <>
              <Row label={`${item.name} × ${qty}`} value={formatIdr(quote.totalIdr)} />
              <div className="h-px bg-divider" />
              <Row label="Total" value={formatIdr(quote.totalIdr)} strong />
              <p className="text-sm text-neutral-600">
                Kamu dapat {quote.pointsEarned.toLocaleString('id-ID')} poin dari pembelian ini.
              </p>
            </>
          ) : (
            <>
              <Row label="Poin kamu sekarang" value={me.points.toLocaleString('id-ID')} />
              <Row
                label={`Ditukar × ${qty}`}
                value={`−${quote.pointsSpent.toLocaleString('id-ID')}`}
              />
              <div className="h-px bg-divider" />
              <Row
                label="Sisa poin"
                value={Math.max(0, me.points - quote.pointsSpent).toLocaleString('id-ID')}
                strong
              />
              <p className="text-sm text-neutral-600">Menukar poin tidak menghasilkan poin baru.</p>
            </>
          )}
        </dl>

        {payMode === 'uang' && (
          <div className="flex flex-col gap-3">
            <h3 className="text-xl">Metode pembayaran</h3>
            <PaymentMethodPicker
              name="merch-payment"
              value={method}
              onChange={setMethod}
              compact
              disabled={order.isPending}
            />
          </div>
        )}

        {blocker && (
          <p role="alert" className="text-base text-accent-700">
            {blocker}
          </p>
        )}

        <div className="flex gap-3">
          <Button variant="secondary" block onClick={onClose} disabled={order.isPending}>
            Batal
          </Button>
          <Button
            block
            disabled={Boolean(blocker) || order.isPending}
            onClick={() =>
              order.mutate(
                {
                  variantId,
                  qty,
                  payMode,
                  ...(payMode === 'uang' ? { paymentMethod: method } : {}),
                },
                {
                  onSuccess: (created) => {
                    onDone(`Pesanan ${created.code} dibuat. Ambil di klub.`)
                    navigate('/toko/pesanan')
                  },
                  onError: (error) => onFailed(error.message),
                },
              )
            }
          >
            {order.isPending ? 'Memproses…' : payMode === 'poin' ? 'Tukar poin' : 'Bayar'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? 'text-md font-bold' : 'text-neutral-700'}>{label}</dt>
      <dd className={strong ? 'font-heading text-2xl text-accent-700' : 'font-semibold'}>
        {value}
      </dd>
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  title,
  detail,
}: {
  active: boolean
  onClick: () => void
  title: string
  detail: string
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        'flex min-h-touch flex-1 flex-col items-start gap-0.5 rounded-lg px-4 py-3 text-left transition-colors',
        active ? 'bg-accent-100 ring-2 ring-accent' : 'bg-surface',
      )}
    >
      <span className="text-base font-bold">{title}</span>
      <span className="text-sm text-neutral-700">{detail}</span>
    </button>
  )
}
