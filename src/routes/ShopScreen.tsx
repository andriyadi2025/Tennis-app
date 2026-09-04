import { useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Receipt, Sparkles } from 'lucide-react'
import type { MerchCategory, MerchItem } from '@/types'
import { MERCH_CATEGORY_LABEL } from '@/types'
import { useMe, useMerch } from '@/hooks/queries'
import { isSoldOut, totalStock } from '@/lib/merch'
import { formatIdr } from '@/lib/money'
import { Screen, ScreenHeader } from '@/components/layout/Screen'
import { Icon } from '@/components/ui/Icon'
import { Chip, VenuePhoto } from '@/components/ui/primitives'
import { AsyncList, EmptyState, SkeletonBlock } from '@/components/ui/states'

const TABS: { value: MerchCategory | 'semua'; label: string }[] = [
  { value: 'semua', label: 'Semua' },
  { value: 'apparel', label: MERCH_CATEGORY_LABEL.apparel },
  { value: 'perlengkapan', label: MERCH_CATEGORY_LABEL.perlengkapan },
  { value: 'aksesori', label: MERCH_CATEGORY_LABEL.aksesori },
  { value: 'konsumsi', label: MERCH_CATEGORY_LABEL.konsumsi },
]

/** Toko klub — barang bisa dibeli, ditukar poin, atau keduanya. */
export function ShopScreen() {
  const [tab, setTab] = useState<MerchCategory | 'semua'>('semua')
  const items = useMerch(tab === 'semua' ? null : tab)
  const profile = useMe()

  return (
    <Screen>
      <ScreenHeader
        title="Toko DBTC"
        action={
          <Link
            to="/toko/pesanan"
            aria-label="Pesanan saya"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-surface"
          >
            <Icon icon={Receipt} size={19} />
          </Link>
        }
      />

      {/* Saldo poin ditaruh di atas katalog: itu yang menentukan barang mana
          yang sebenarnya bisa ditebus, jadi jangan disembunyikan di profil. */}
      <div className="flex items-center gap-3.5 rounded-lg bg-accent-700 px-4 py-3.5 text-bg">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-accent-600">
          <Icon icon={Sparkles} size={19} />
        </span>
        <div className="flex flex-1 flex-col">
          <span className="text-sm opacity-90">Poin DBTC kamu</span>
          {profile.isLoading ? (
            <SkeletonBlock className="mt-1 h-5 w-24 rounded-pill" />
          ) : (
            <span className="font-heading text-2xl">
              {(profile.data?.points ?? 0).toLocaleString('id-ID')}
            </span>
          )}
        </div>
        <span className="max-w-[11ch] text-right text-sm opacity-90">
          Bisa ditukar barang di bawah
        </span>
      </div>

      <div className="row-scroll -mx-5 flex gap-2 px-5" role="tablist" aria-label="Kategori barang">
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
        isLoading={items.isLoading}
        error={items.error}
        data={items.data}
        onRetry={() => void items.refetch()}
        skeleton={
          <div className="grid grid-cols-2 gap-3" aria-hidden>
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonBlock key={i} className="h-56 w-full rounded-lg" />
            ))}
          </div>
        }
        empty={
          <EmptyState
            title="Belum ada barang"
            body="Kategori ini belum diisi klub. Coba kategori lain."
          />
        }
      >
        {(rows) => (
          <ul className="grid grid-cols-2 gap-3">
            {rows.map((item) => (
              <li key={item.id}>
                <ItemCard item={item} />
              </li>
            ))}
          </ul>
        )}
      </AsyncList>

      <p className="text-sm text-neutral-600">
        Barang diambil di klub, tidak dikirim. Tunjukkan kode pesanan ke petugas.
      </p>
    </Screen>
  )
}

function ItemCard({ item }: { item: MerchItem }) {
  const habis = isSoldOut(item)
  const sisa = totalStock(item)

  return (
    <Link
      to={`/toko/${item.id}`}
      className="flex h-full flex-col gap-2 rounded-lg bg-surface p-3 transition-colors hover:bg-neutral-200"
    >
      <div className="relative">
        <VenuePhoto photo={item.photo} className="aspect-square w-full" />
        {habis && (
          <span className="sheet-backdrop absolute inset-0 flex items-center justify-center rounded-md">
            <span className="rounded-pill bg-bg px-3 py-1 text-xs font-semibold">Habis</span>
          </span>
        )}
      </div>

      {/* Barisnya baru muncul kalau memang ada isinya: baris kosong menyisakan
          celah yang membuat kartu bersebelahan tampak tidak sejajar. */}
      {(item.membersOnly || (!habis && sisa <= 3)) && (
        <div className="flex flex-wrap gap-1.5">
          {item.membersOnly && <Chip tone="sage">Anggota</Chip>}
          {/* Sisa sedikit disebut apa adanya — itu yang membuat orang memutuskan. */}
          {!habis && sisa <= 3 && <Chip tone="accent">Sisa {sisa}</Chip>}
        </div>
      )}

      <h3 className="text-base font-bold leading-snug">{item.name}</h3>

      <div className="mt-auto flex flex-col gap-0.5">
        {item.priceIdr !== null && (
          <span className="font-heading text-md text-accent-700">{formatIdr(item.priceIdr)}</span>
        )}
        {item.pricePoints !== null && (
          <span
            className={clsx(
              'text-accent2-800',
              // Tanpa harga rupiah, harga poin adalah harga utamanya.
              item.priceIdr === null ? 'font-heading text-md' : 'text-sm',
            )}
          >
            {item.priceIdr !== null && 'atau '}
            {item.pricePoints.toLocaleString('id-ID')} poin
          </span>
        )}
      </div>
    </Link>
  )
}
