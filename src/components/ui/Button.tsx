import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'

type Variant = 'primary' | 'secondary' | 'ghost' | 'sage'
type Size = 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-bg hover:bg-accent-600 active:bg-accent-700',
  secondary: 'border border-divider text-text hover:bg-neutral-200',
  ghost: 'text-accent-700 hover:bg-accent-100',
  sage: 'bg-accent2-600 text-accent2-100 hover:bg-accent2-700',
}

// min-h-touch menjaga target sentuh >= 44px di semua ukuran.
const SIZES: Record<Size, string> = {
  md: 'min-h-touch px-5 text-md',
  lg: 'min-h-[54px] px-6 text-xl',
}

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-pill font-heading leading-none ' +
  'transition-colors disabled:opacity-45 disabled:pointer-events-none'

interface CommonProps {
  variant?: Variant
  size?: Size
  block?: boolean
  children: ReactNode
  className?: string
}

type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement>

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={clsx(BASE, VARIANTS[variant], SIZES[size], block && 'w-full', className)}
      {...rest}
    >
      {children}
    </button>
  )
}

interface LinkButtonProps extends CommonProps {
  to: string
  state?: unknown
  replace?: boolean
  /** Efek samping sebelum berpindah, mis. menyimpan konteks ke draft store. */
  onClick?: () => void
}

export function LinkButton({
  to,
  state,
  replace,
  onClick,
  variant = 'primary',
  size = 'md',
  block = false,
  className,
  children,
}: LinkButtonProps) {
  return (
    <Link
      to={to}
      state={state}
      replace={replace}
      onClick={onClick}
      className={clsx(BASE, VARIANTS[variant], SIZES[size], block && 'w-full', className)}
    >
      {children}
    </Link>
  )
}
