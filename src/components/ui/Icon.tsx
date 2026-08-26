import type { LucideIcon } from 'lucide-react'

interface IconProps {
  icon: LucideIcon
  size?: number
  className?: string
  /** Ikon dekoratif disembunyikan dari screen reader (default). */
  label?: string
}

/**
 * Satu-satunya tempat stroke-width ikon ditentukan. Brief mematok 2.75 untuk
 * seluruh app; komponen lain tidak boleh meneruskan strokeWidth sendiri.
 */
export function Icon({ icon: Glyph, size = 20, className, label }: IconProps) {
  return (
    <Glyph
      size={size}
      strokeWidth={2.75}
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  )
}
