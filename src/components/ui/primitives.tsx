import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { useId } from 'react'
import clsx from 'clsx'
import { Star } from 'lucide-react'
import type { PhotoBlock } from '@/types'
import { Icon } from './Icon'

/* ── Kartu ─────────────────────────────────────────────────────────────── */

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('rounded-lg bg-surface p-4', className)}>{children}</div>
}

/* ── Chip / tag ────────────────────────────────────────────────────────── */

type ChipTone = 'accent' | 'sage' | 'neutral' | 'outline'

const CHIP_TONES: Record<ChipTone, string> = {
  accent: 'bg-accent-100 text-accent-800',
  sage: 'bg-accent2-100 text-accent2-800',
  neutral: 'bg-neutral-200 text-neutral-800',
  outline: 'border border-divider text-text',
}

export function Chip({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: ChipTone
  className?: string
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-xs',
        CHIP_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Chip yang bisa diklik — dipakai filter dan tab lapangan. */
export function ToggleChip({
  children,
  active,
  onClick,
  className,
  ...rest
}: {
  children: ReactNode
  active: boolean
  onClick: () => void
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children' | 'className'>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        'min-h-touch shrink-0 rounded-pill px-4 text-base font-semibold transition-colors',
        active
          ? 'bg-accent2-600 text-accent2-100'
          : 'border border-divider text-text hover:bg-neutral-200',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

/* ── Field ─────────────────────────────────────────────────────────────── */

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string
  hint?: string
  error?: string
  /** Sembunyikan label secara visual tapi tetap terbaca screen reader. */
  hideLabel?: boolean
  leading?: ReactNode
}

export function TextField({
  label,
  hint,
  error,
  hideLabel = false,
  leading,
  id,
  ...rest
}: TextFieldProps) {
  const generated = useId()
  const inputId = id ?? generated
  const describedBy = [hint ? `${inputId}-hint` : null, error ? `${inputId}-error` : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className={clsx('text-sm text-neutral-700', hideLabel && 'sr-only')}>
        {label}
      </label>
      <div
        className={clsx(
          'flex min-h-touch items-center gap-2.5 rounded-pill bg-surface px-5',
          error ? 'border border-accent-700' : 'border border-transparent',
        )}
      >
        {leading}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className="w-full bg-transparent text-lg text-text placeholder:text-neutral-600 focus:outline-none"
          {...rest}
        />
      </div>
      {hint && !error && (
        <span id={`${inputId}-hint`} className="px-2 text-sm text-neutral-600">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${inputId}-error`} className="px-2 text-sm text-accent-700">
          {error}
        </span>
      )}
    </div>
  )
}

/* ── Toggle ────────────────────────────────────────────────────────────── */

export function Toggle({
  checked,
  onChange,
  label,
  description,
  leading,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  description?: string
  leading?: ReactNode
}) {
  const id = useId()
  return (
    <div className="flex items-center gap-3.5 rounded-lg bg-surface p-4">
      {leading}
      <div className="flex flex-1 flex-col">
        <label htmlFor={id} className="text-md font-bold">
          {label}
        </label>
        {description && <span className="text-sm text-neutral-700">{description}</span>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={clsx(
          'flex h-7 w-12 shrink-0 items-center rounded-pill p-[3px] transition-colors',
          checked ? 'justify-end bg-accent2-600' : 'justify-start bg-neutral-400',
        )}
      >
        <span className="h-[22px] w-[22px] rounded-pill bg-bg" />
      </button>
    </div>
  )
}

/* ── Rating ────────────────────────────────────────────────────────────── */

export function RatingStars({ value, size = 14 }: { value: number; size?: number }) {
  const rounded = Math.round(value)
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} dari 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          strokeWidth={2.75}
          className={n <= rounded ? 'fill-accent text-accent' : 'text-neutral-400'}
        />
      ))}
    </span>
  )
}

export function RatingValue({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-base font-semibold">
      <Icon icon={Star} size={size} className="fill-accent text-accent" />
      {value.toFixed(1).replace('.', ',')}
    </span>
  )
}

/* ── Placeholder foto venue ────────────────────────────────────────────── */

const TONE_BG: Record<PhotoBlock['tone'], Record<PhotoBlock['step'], string>> = {
  accent: { 200: 'bg-accent-200', 300: 'bg-accent-300', 400: 'bg-accent-400' },
  accent2: { 200: 'bg-accent2-200', 300: 'bg-accent2-300', 400: 'bg-accent2-400' },
  neutral: { 200: 'bg-neutral-200', 300: 'bg-neutral-300', 400: 'bg-neutral-400' },
}

const TONE_DECOR: Record<PhotoBlock['tone'], string> = {
  accent: 'bg-accent-100',
  accent2: 'bg-accent2-100',
  neutral: 'bg-neutral-100',
}

/**
 * Foto venue diwakili blok warna beraksen + dua bentuk bulat dekoratif.
 * Posisi lingkaran diturunkan dari `seed` — deterministik, jadi venue yang
 * sama selalu tampil sama, dan tidak ada ilustrasi SVG rumit seperti yang
 * dilarang brief.
 */
export function VenuePhoto({
  photo,
  className,
  rounded = 'rounded-md',
}: {
  photo: PhotoBlock
  className?: string
  rounded?: string
}) {
  const a = photo.seed % 7
  const b = (photo.seed * 3) % 11
  return (
    <div
      aria-hidden
      className={clsx(
        'relative overflow-hidden',
        TONE_BG[photo.tone][photo.step],
        rounded,
        className,
      )}
    >
      <span
        className={clsx('absolute rounded-pill opacity-60', TONE_DECOR[photo.tone])}
        style={{
          width: '58%',
          aspectRatio: '1',
          left: `${8 + a * 9}%`,
          top: `${-18 + b * 5}%`,
        }}
      />
      <span
        className={clsx('absolute rounded-pill opacity-40', TONE_DECOR[photo.tone])}
        style={{
          width: '36%',
          aspectRatio: '1',
          right: `${4 + b * 4}%`,
          bottom: `${-12 + a * 6}%`,
        }}
      />
    </div>
  )
}

/* ── Progress ──────────────────────────────────────────────────────────── */

export function ProgressBar({
  ratio,
  tone = 'accent',
  label,
}: {
  ratio: number
  tone?: 'accent' | 'sage'
  label: string
}) {
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100)
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-2.5 w-full overflow-hidden rounded-pill bg-neutral-300"
    >
      <span
        className={clsx(
          'block h-full rounded-pill transition-[width] duration-500',
          tone === 'accent' ? 'bg-accent' : 'bg-accent2-600',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/* ── Avatar inisial ────────────────────────────────────────────────────── */

export function Avatar({
  name,
  size = 36,
  tone = 'accent',
}: {
  name: string
  size?: number
  tone?: 'accent' | 'sage' | 'neutral'
}) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
  const bg =
    tone === 'accent'
      ? 'bg-accent-200 text-accent-800'
      : tone === 'sage'
        ? 'bg-accent2-200 text-accent2-800'
        : 'bg-neutral-300 text-neutral-800'
  return (
    <span
      aria-hidden
      className={clsx('flex shrink-0 items-center justify-center rounded-pill font-heading', bg)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initials}
    </span>
  )
}
