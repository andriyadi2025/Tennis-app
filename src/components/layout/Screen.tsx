import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { ChevronLeft } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'

/**
 * Kerangka satu layar: area scroll di tengah, bar sticky opsional di bawah.
 * Semua jarak antar kelompok elemen pakai gap, bukan margin per-elemen.
 */
export function Screen({
  children,
  bottom,
  className,
}: {
  children: ReactNode
  /** Sticky bottom bar: CTA utama atau bottom nav. */
  bottom?: ReactNode
  className?: string
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <div className={clsx('scroll-area flex flex-1 flex-col gap-6 px-5 pb-6 pt-5', className)}>
        {children}
      </div>
      {bottom}
    </div>
  )
}

/** Header dengan tombol kembali — dipakai layar kedalaman kedua. */
export function ScreenHeader({
  title,
  action,
  onBack,
}: {
  title: string
  action?: ReactNode
  onBack?: () => void
}) {
  const navigate = useNavigate()
  return (
    <header className="flex items-center gap-3.5">
      <button
        type="button"
        onClick={onBack ?? (() => navigate(-1))}
        aria-label="Kembali"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-surface"
      >
        <Icon icon={ChevronLeft} size={20} />
      </button>
      <h1 className="flex-1 truncate text-2xl">{title}</h1>
      {action}
    </header>
  )
}

/** Bar bawah yang menempel — CTA utama tiap alur. */
export function StickyBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-3.5 rounded-t-lg bg-surface px-5 pb-5 pt-4">
      {children}
    </div>
  )
}

/** Judul bagian dengan aksi "Lihat semua" opsional. */
export function SectionHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-3xl">{title}</h2>
      {action}
    </div>
  )
}
