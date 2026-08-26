import type { ReactNode } from 'react'
import clsx from 'clsx'
import { RefreshCw } from 'lucide-react'
import { Button } from './Button'
import { Icon } from './Icon'

/**
 * Tiap daftar di app ini punya tiga keadaan nyata: memuat, kosong, gagal.
 * Brief melarang spinner telanjang — memuat selalu berbentuk skeleton yang
 * meniru bentuk kontennya.
 */

export function SkeletonBlock({ className }: { className?: string }) {
  return <span className={clsx('skeleton block rounded-md', className)} />
}

/** Skeleton kartu venue: blok foto + tiga baris teks. */
export function VenueCardSkeleton() {
  return (
    <div className="flex gap-3.5 rounded-lg bg-surface p-3.5">
      <SkeletonBlock className="h-[92px] w-[92px] shrink-0" />
      <div className="flex flex-1 flex-col gap-2 py-1">
        <SkeletonBlock className="h-4 w-3/5 rounded-pill" />
        <SkeletonBlock className="h-3 w-4/5 rounded-pill" />
        <SkeletonBlock className="mt-auto h-3 w-2/5 rounded-pill" />
      </div>
    </div>
  )
}

export function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3.5" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <VenueCardSkeleton key={i} />
      ))}
    </div>
  )
}

/** Skeleton baris ringkas — untuk notifikasi, chat, anggota tim. */
export function RowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg bg-surface p-3.5">
          <SkeletonBlock className="h-11 w-11 rounded-pill" />
          <div className="flex flex-1 flex-col gap-2">
            <SkeletonBlock className="h-3.5 w-1/2 rounded-pill" />
            <SkeletonBlock className="h-3 w-4/5 rounded-pill" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function GridSkeleton({ count = 9 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 gap-2.5" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonBlock key={i} className="h-[46px]" />
      ))}
    </div>
  )
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg bg-surface px-6 py-10 text-center">
      {/* Bentuk bulat dekoratif, bukan ilustrasi — sesuai batasan visual. */}
      <span aria-hidden className="h-14 w-14 rounded-pill bg-accent2-200" />
      <h4 className="text-xl">{title}</h4>
      <p className="max-w-[26ch] text-base text-neutral-700">{body}</p>
      {action}
    </div>
  )
}

export function ErrorState({
  title = 'Gagal memuat',
  body,
  onRetry,
}: {
  title?: string
  body: string
  onRetry?: () => void
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-lg bg-accent-100 px-6 py-8 text-center"
    >
      <span aria-hidden className="h-12 w-12 rounded-pill bg-accent-300" />
      <h4 className="text-xl text-accent-900">{title}</h4>
      <p className="max-w-[28ch] text-base text-accent-800">{body}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          <Icon icon={RefreshCw} size={16} />
          Coba lagi
        </Button>
      )}
    </div>
  )
}

interface AsyncListProps<T> {
  isLoading: boolean
  error: Error | null
  data: T[] | undefined
  skeleton: ReactNode
  empty: ReactNode
  onRetry?: () => void
  children: (rows: T[]) => ReactNode
}

/**
 * Menjaga urutan memuat → gagal → kosong → isi tetap sama di semua layar,
 * supaya tidak ada daftar yang diam-diam kehilangan salah satu keadaannya.
 */
export function AsyncList<T>({
  isLoading,
  error,
  data,
  skeleton,
  empty,
  onRetry,
  children,
}: AsyncListProps<T>) {
  if (isLoading) return <>{skeleton}</>
  if (error) return <ErrorState body={error.message} onRetry={onRetry} />
  if (!data || data.length === 0) return <>{empty}</>
  return <>{children(data)}</>
}
