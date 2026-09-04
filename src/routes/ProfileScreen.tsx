import { Link, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import {
  AtSign,
  Bell,
  BadgeCheck,
  ChevronRight,
  CreditCard,
  LifeBuoy,
  Receipt,
  Settings,
  ShoppingBag,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Swords,
  Trophy,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Activity, ActivityKind, ActivityTally } from '@/types'
import { ACTIVITY_LABEL, SPORT_LABEL } from '@/types'
import { useActivities, useMe } from '@/hooks/queries'
import { useAuthStore } from '@/store/auth'
import { resendVerification } from '@/lib/authApi'
import { useToast } from '@/hooks/useToast'
import { tierProgress } from '@/lib/points'
import { formatDateShort, formatMonthYear, formatRelative } from '@/lib/dates'
import { Screen, SectionHeading } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Toast } from '@/components/ui/Toast'
import { Avatar, Chip, ProgressBar } from '@/components/ui/primitives'
import { ErrorState, SkeletonBlock } from '@/components/ui/states'

const MENU: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/toko', label: 'Toko DBTC', icon: ShoppingBag },
  { to: '/toko/pesanan', label: 'Pesanan toko', icon: Receipt },
  { to: '/bantuan', label: 'Bantuan & aduan', icon: LifeBuoy },
  { to: '/bookings', label: 'Metode pembayaran', icon: CreditCard },
  { to: '/match', label: 'Tim & komunitas', icon: Users },
  { to: '/sparring', label: 'Ajakan sparring', icon: Swords },
  { to: '/tournaments', label: 'Turnamen saya', icon: Trophy },
  { to: '/notifications', label: 'Notifikasi', icon: Bell },
  { to: '/settings', label: 'Pengaturan', icon: Settings },
]

/**
 * 10 · Profil & poin.
 *
 * Dua sumber, sengaja tidak dicampur: identitas (nama, nomor, email, status
 * verifikasi, peran) datang dari server auth; profil main (poin, tier, cabang
 * favorit) datang dari layanan domain. Menggabungkannya jadi satu objek akan
 * menyembunyikan bahwa yang satu sudah nyata dan yang lain masih tiruan.
 */
export function ProfileScreen() {
  const account = useAuthStore((s) => s.user)
  const signOut = useAuthStore((s) => s.signOut)
  const navigate = useNavigate()
  const profile = useMe()
  const feed = useActivities()
  const { toast, show } = useToast()

  if (profile.isLoading && !profile.data) {
    return (
      <Screen>
        <SectionHeading title="Profil" />
        <SkeletonBlock className="h-32 w-full rounded-lg" />
        <SkeletonBlock className="h-40 w-full rounded-lg" />
      </Screen>
    )
  }

  if (!account || !profile.data) {
    return (
      <Screen>
        <SectionHeading title="Profil" />
        <ErrorState body="Data profil tidak tersedia." onRetry={() => void profile.refetch()} />
      </Screen>
    )
  }

  const play = profile.data
  const progress = tierProgress(play.points)

  return (
    <Screen overlay={<Toast toast={toast} />}>
      <SectionHeading title="Profil" />

      <section className="flex items-center gap-4 rounded-lg bg-surface p-4">
        <Avatar name={account.name} size={64} tone="accent" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="truncate text-2xl">{account.name}</h2>
          <p className="truncate text-base text-neutral-700">
            {account.phone ?? account.email ?? 'Belum ada kontak'}
          </p>
          <Chip tone="sage" className="self-start">
            {/* Dihitung dari catatan aktivitas, bukan angka yang ditanam. */}
            {SPORT_LABEL[play.favouriteSport]} · {feed.data?.matchesPlayed ?? 0} main
          </Chip>
        </div>
      </section>

      <IdentitySection account={account} onDone={show} />

      {/* Poin & tier */}
      <section className="flex flex-col gap-4 rounded-lg bg-accent-700 p-5 text-accent-100">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-base">Poin DBTC</span>
            <span className="font-heading text-4xl text-bg">
              {play.points.toLocaleString('id-ID')}
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

      {account.role === 'admin' && (
        <Link
          to="/admin"
          className="flex min-h-touch items-center gap-3.5 rounded-lg bg-accent2-700 px-4 py-3.5 text-accent2-100"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-accent2-600 text-bg">
            <Icon icon={ShieldCheck} size={19} />
          </span>
          <span className="flex flex-1 flex-col">
            <span className="font-heading text-md text-bg">Dasbor klub</span>
            <span className="text-sm">Atur lapangan, tarif, dan jam buka.</span>
          </span>
          <Icon icon={ChevronRight} size={17} />
        </Link>
      )}

      <ActivitySection feed={feed} />

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
        <Button
          variant="secondary"
          block
          onClick={() => {
            signOut()
            navigate('/login', { replace: true })
          }}
        >
          Keluar
        </Button>
        <p className="text-center text-sm text-neutral-600">
          Anggota sejak {formatMonthYear(account.createdAt)}
        </p>
      </div>
    </Screen>
  )
}

const KIND_TONE: Record<ActivityKind, 'accent' | 'sage' | 'neutral'> = {
  bermain: 'accent',
  berlatih: 'sage',
  mainBersama: 'sage',
  lomba: 'accent',
}

/**
 * Riwayat main. Catatannya diturunkan dari booking, open match, turnamen, dan
 * sparring yang sudah terjadi — jadi tidak bisa menyimpang dari kejadiannya.
 */
function ActivitySection({ feed }: { feed: ReturnType<typeof useActivities> }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-3xl">Riwayat main</h2>

      {feed.isLoading ? (
        <SkeletonBlock className="h-40 w-full rounded-lg" />
      ) : feed.error ? (
        <ErrorState body={feed.error.message} onRetry={() => void feed.refetch()} />
      ) : feed.data && feed.data.activities.length > 0 ? (
        <>
          <Tally tally={feed.data.tally} />
          <p className="text-base text-neutral-700">
            {feed.data.pointsFromActivities.toLocaleString('id-ID')} poin dari partisipasi, terpisah
            dari poin belanja.
          </p>
          <ul className="flex flex-col gap-2">
            {feed.data.activities.slice(0, 8).map((activity) => (
              <li key={activity.id}>
                <ActivityRow activity={activity} />
              </li>
            ))}
          </ul>
          {feed.data.activities.length > 8 && (
            <p className="text-sm text-neutral-600">
              +{feed.data.activities.length - 8} kegiatan lain
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg bg-surface px-5 py-6 text-center">
          <h3 className="text-xl">Belum ada kegiatan</h3>
          <p className="text-base text-neutral-700">
            Booking, open match, turnamen, dan sparring yang sudah selesai muncul di sini beserta
            poinnya.
          </p>
        </div>
      )}
    </section>
  )
}

function Tally({ tally }: { tally: ActivityTally }) {
  const kinds = Object.keys(ACTIVITY_LABEL) as ActivityKind[]
  return (
    <dl className="grid grid-cols-4 gap-2">
      {kinds.map((kind) => (
        <div key={kind} className="flex flex-col items-center gap-0.5 rounded-md bg-surface py-3">
          <dd className="font-heading text-2xl">{tally[kind]}</dd>
          <dt className="px-1 text-center text-xs leading-tight text-neutral-700">
            {ACTIVITY_LABEL[kind]}
          </dt>
        </div>
      ))}
    </dl>
  )
}

function ActivityRow({ activity }: { activity: Activity }) {
  return (
    <article className="flex items-start gap-3 rounded-md bg-surface px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <Chip tone={KIND_TONE[activity.kind]}>{ACTIVITY_LABEL[activity.kind]}</Chip>
          <span className="text-sm text-neutral-600">{formatRelative(activity.occurredAt)}</span>
        </div>
        <span className="truncate text-base font-semibold">{activity.title}</span>
        <span className="truncate text-sm text-neutral-700">
          {formatDateShort(activity.occurredAt)}
          {activity.withNames.length > 0 &&
            ` · bareng ${activity.withNames.slice(0, 3).join(', ')}`}
          {activity.withNames.length > 3 && ` +${activity.withNames.length - 3}`}
        </span>
      </div>
      <span className="shrink-0 font-heading text-base text-accent-700">
        +{activity.pointsEarned}
      </span>
    </article>
  )
}

/** Kontak dan status verifikasinya — datanya dari server auth. */
function IdentitySection({
  account,
  onDone,
}: {
  account: NonNullable<ReturnType<typeof useAuthStore.getState>['user']>
  onDone: (message: string, tone?: 'sukses' | 'gagal') => void
}) {
  const token = useAuthStore((s) => s.token)
  const identities = useAuthStore((s) => s.identities)

  const resend = useMutation({
    mutationFn: () => resendVerification(token ?? ''),
    onSuccess: (result) =>
      onDone(
        result.devToken
          ? `Mode pengembangan — token: ${result.devToken}`
          : 'Email verifikasi dikirim ulang.',
      ),
    onError: (error) => onDone(error.message, 'gagal'),
  })

  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-3xl">Cara masuk</h2>

      {account.phone && (
        <ContactRow
          icon={Smartphone}
          label={account.phone}
          verified={account.phoneVerified}
          note={account.phoneVerified ? 'Terverifikasi lewat OTP' : 'Belum terverifikasi'}
        />
      )}

      {account.email && (
        <div className="flex flex-col gap-2">
          <ContactRow
            icon={AtSign}
            label={account.email}
            verified={account.emailVerified}
            note={account.emailVerified ? 'Terverifikasi' : 'Belum terverifikasi'}
          />
          {!account.emailVerified && (
            <Button
              variant="secondary"
              block
              disabled={resend.isPending}
              onClick={() => resend.mutate()}
            >
              {resend.isPending ? 'Mengirim…' : 'Kirim ulang email verifikasi'}
            </Button>
          )}
        </div>
      )}

      {identities.map((identity) => (
        <ContactRow
          key={identity.provider}
          icon={BadgeCheck}
          label={identity.provider === 'google' ? 'Google' : 'Facebook'}
          verified
          note={identity.email ?? 'Tertaut'}
        />
      ))}

      {!account.phone && !account.email && identities.length === 0 && (
        <p className="text-base text-neutral-700">Belum ada kontak yang tercatat.</p>
      )}
    </section>
  )
}

function ContactRow({
  icon,
  label,
  verified,
  note,
}: {
  icon: LucideIcon
  label: string
  verified: boolean
  note: string
}) {
  return (
    <div className="flex min-h-touch items-center gap-3.5 rounded-md bg-surface px-4 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-neutral-200 text-neutral-800">
        <Icon icon={icon} size={18} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-base font-semibold">{label}</span>
        <span className="text-sm text-neutral-700">{note}</span>
      </span>
      <Chip tone={verified ? 'sage' : 'accent'}>{verified ? 'Terverifikasi' : 'Belum'}</Chip>
    </div>
  )
}
