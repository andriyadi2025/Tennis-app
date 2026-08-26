import { Link } from 'react-router-dom'
import { Bell, ChevronRight, CreditCard, Settings, Sparkles, Trophy, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SPORT_LABEL } from '@/types'
import { useMe } from '@/hooks/queries'
import { useAuthStore } from '@/store/auth'
import { tierProgress } from '@/lib/points'
import { formatMonthYear } from '@/lib/dates'
import { Screen, SectionHeading } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Avatar, Chip, ProgressBar } from '@/components/ui/primitives'
import { ErrorState, SkeletonBlock } from '@/components/ui/states'

const MENU: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/bookings', label: 'Metode pembayaran', icon: CreditCard },
  { to: '/team/t-smash', label: 'Tim & komunitas', icon: Users },
  { to: '/tournaments', label: 'Turnamen saya', icon: Trophy },
  { to: '/notifications', label: 'Notifikasi', icon: Bell },
  { to: '/profile', label: 'Pengaturan', icon: Settings },
]

/** 10 · Profil & poin loyalitas. */
export function ProfileScreen() {
  const stored = useAuthStore((s) => s.user)
  const signOut = useAuthStore((s) => s.signOut)
  const me = useMe()
  const user = me.data ?? stored

  if (me.isLoading && !user) {
    return (
      <Screen>
        <SectionHeading title="Profil" />
        <SkeletonBlock className="h-32 w-full rounded-lg" />
        <SkeletonBlock className="h-40 w-full rounded-lg" />
      </Screen>
    )
  }

  if (!user) {
    return (
      <Screen>
        <SectionHeading title="Profil" />
        <ErrorState body="Data profil tidak tersedia." onRetry={() => void me.refetch()} />
      </Screen>
    )
  }

  const progress = tierProgress(user.points)

  return (
    <Screen>
      <SectionHeading title="Profil" />

      <section className="flex items-center gap-4 rounded-lg bg-surface p-4">
        <Avatar name={user.name} size={64} tone="accent" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="truncate text-2xl">{user.name}</h2>
          <p className="truncate text-base text-neutral-700">{user.phone}</p>
          <Chip tone="sage" className="self-start">
            {SPORT_LABEL[user.favouriteSport]} · {user.matchesPlayed} main
          </Chip>
        </div>
      </section>

      {/* Poin & tier */}
      <section className="flex flex-col gap-4 rounded-lg bg-accent-700 p-5 text-accent-100">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-base">Poin Lapangin</span>
            <span className="font-heading text-4xl text-bg">
              {user.points.toLocaleString('id-ID')}
            </span>
          </div>
          <span className="flex h-12 w-12 items-center justify-center rounded-pill bg-accent-600 text-bg">
            <Icon icon={Sparkles} size={22} />
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between text-base">
            <span className="font-heading text-bg">{progress.tier}</span>
            {progress.next && <span>{progress.next}</span>}
          </div>
          <ProgressBar
            ratio={progress.ratio}
            tone="accent"
            label={`Progres menuju ${progress.next ?? progress.tier}`}
          />
          <span className="text-base">
            {progress.next
              ? `${progress.pointsToNext.toLocaleString('id-ID')} poin lagi menuju ${progress.next}.`
              : 'Kamu sudah di tier tertinggi.'}
          </span>
        </div>

        <p className="text-base opacity-90">
          100 poin = Rp10.000 potongan, bisa dipakai sampai 30% dari subtotal booking.
        </p>
      </section>

      <section className="flex flex-col gap-2.5">
        <h2 className="text-3xl">Akun</h2>
        <ul className="flex flex-col gap-2">
          {MENU.map(({ to, label, icon }) => (
            <li key={label}>
              <Link
                to={to}
                className="flex min-h-touch items-center gap-3.5 rounded-md bg-surface px-4 py-3"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-neutral-200 text-neutral-800">
                  <Icon icon={icon} size={18} />
                </span>
                <span className="flex-1 text-base font-semibold">{label}</span>
                <Icon icon={ChevronRight} size={17} className="text-neutral-600" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-col gap-2">
        <Button variant="secondary" block onClick={signOut}>
          Keluar
        </Button>
        <p className="text-center text-sm text-neutral-600">
          Anggota sejak {formatMonthYear(user.joinedAt)}
        </p>
      </div>
    </Screen>
  )
}
