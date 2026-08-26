import { NavLink } from 'react-router-dom'
import clsx from 'clsx'
import { CalendarDays, House, Search, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface Tab {
  to: string
  label: string
  icon: LucideIcon
}

/** Empat tab tetap, konsisten di seluruh rute tingkat atas. */
const TABS: Tab[] = [
  { to: '/', label: 'Home', icon: House },
  { to: '/match', label: 'Lawan', icon: Search },
  { to: '/bookings', label: 'Booking', icon: CalendarDays },
  { to: '/profile', label: 'Profil', icon: User },
]

export function BottomNav() {
  return (
    <nav
      aria-label="Navigasi utama"
      className="flex shrink-0 items-center justify-around rounded-t-lg bg-surface px-4 pb-4 pt-3"
    >
      {TABS.map(({ to, label, icon: Glyph }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            clsx(
              'flex min-h-touch min-w-touch flex-col items-center justify-center gap-1 rounded-md px-2',
              isActive ? 'text-accent-700' : 'text-neutral-600',
            )
          }
        >
          {({ isActive }) => (
            <>
              <Glyph size={22} strokeWidth={2.75} aria-hidden />
              <span className={clsx('text-xs', isActive ? 'font-bold' : 'font-normal')}>
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
