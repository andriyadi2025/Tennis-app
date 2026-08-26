import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, ChevronRight, MapPin, Search, Swords, Trophy, Users } from 'lucide-react'
import type { Sport } from '@/types'
import { SPORTS, SPORT_LABEL } from '@/types'
import { useMe, useNotifications, useOpenMatches, useVenues } from '@/hooks/queries'
import { useAuthStore } from '@/store/auth'
import { formatHour } from '@/lib/dates'
import { Screen, SectionHeading } from '@/components/layout/Screen'
import { Icon } from '@/components/ui/Icon'
import { Chip, VenuePhoto } from '@/components/ui/primitives'
import { AsyncList, EmptyState, ListSkeleton, RowSkeleton } from '@/components/ui/states'
import { OpenMatchCard, SportBubble, VenueCard } from '@/components/domain/cards'
import { SPORT_ICON, sportTone } from '@/components/domain/sport'

const ALL_VENUES = {
  q: '',
  sport: null,
  minPrice: 0,
  maxPrice: 1_000_000,
  maxDistance: 999,
  indoorOnly: false,
} as const

/** Empat kategori pertama tampil sebagai bubble; sisanya di balik "Lainnya". */
const FEATURED_SPORTS: Sport[] = ['badminton', 'futsal', 'basketball', 'tennis']

function greeting(now: Date = new Date()): string {
  const h = now.getHours()
  if (h < 11) return 'Pagi'
  if (h < 15) return 'Siang'
  if (h < 18) return 'Sore'
  return 'Malam'
}

type HomeTab = 'venue' | 'komunitas'

/** 02 · Home (tab Venue) dan 13 · Home v2 (tab Komunitas). */
export function HomeScreen() {
  const [tab, setTab] = useState<HomeTab>('venue')
  const navigate = useNavigate()
  const storedUser = useAuthStore((s) => s.user)
  const { data: me } = useMe()
  const user = me ?? storedUser
  const notifications = useNotifications()
  const unread = (notifications.data ?? []).filter((n) => !n.read).length
  const firstName = (user?.name ?? '').split(' ')[0] ?? ''

  return (
    <Screen>
      <header className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-base text-neutral-600">
            {greeting()}, {firstName}
          </span>
          <span className="flex items-center gap-1.5 font-heading text-2xl">
            <Icon icon={MapPin} size={17} className="text-accent" />
            Bandung Utara
          </span>
        </div>
        <Link
          to="/notifications"
          aria-label={unread > 0 ? `Notifikasi, ${unread} belum dibaca` : 'Notifikasi'}
          className="relative flex h-11 w-11 items-center justify-center rounded-pill bg-surface"
        >
          <Icon icon={Bell} size={20} />
          {/* Titik hanya muncul kalau memang ada yang belum dibaca. */}
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute right-2.5 top-2.5 h-2.5 w-2.5 rounded-pill border-2 border-bg bg-accent"
            />
          )}
        </Link>
      </header>

      <Link
        to="/search"
        className="flex min-h-touch items-center gap-2.5 rounded-pill bg-surface px-5"
      >
        <Icon icon={Search} size={19} className="text-accent-700" />
        <span className="text-lg text-neutral-600">Cari venue atau cabang olahraga</span>
      </Link>

      {/* Segmented control — dua wajah home dalam satu rute. */}
      <div
        role="tablist"
        aria-label="Tampilan home"
        className="flex gap-1 rounded-pill bg-surface p-1"
      >
        {(['venue', 'komunitas'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={
              tab === value
                ? 'min-h-touch flex-1 rounded-pill bg-accent px-4 font-heading text-md text-bg'
                : 'min-h-touch flex-1 rounded-pill px-4 font-heading text-md text-neutral-700'
            }
          >
            {value === 'venue' ? 'Venue' : 'Komunitas'}
          </button>
        ))}
      </div>

      {tab === 'venue' ? (
        <VenueHome onPickSport={(s) => navigate(`/search?sport=${s}`)} />
      ) : (
        <CommunityHome />
      )}
    </Screen>
  )
}

/* ── 02 · Home: kategori, banner open match, venue dekat ────────────────── */

function VenueHome({ onPickSport }: { onPickSport: (sport: Sport) => void }) {
  const venues = useVenues(ALL_VENUES)
  const matches = useOpenMatches(null)
  const banner = matches.data?.[0]

  return (
    <>
      <div className="flex gap-3">
        {FEATURED_SPORTS.map((sport) => (
          <SportBubble
            key={sport}
            label={SPORT_LABEL[sport]}
            tone={sportTone(sport)}
            onClick={() => onPickSport(sport)}
            icon={<Icon icon={SPORT_ICON[sport]} size={24} />}
          />
        ))}
        <SportBubble
          label="Lainnya"
          tone="neutral"
          onClick={() => onPickSport(SPORTS[4] ?? 'padel')}
          icon={
            <span className="font-heading text-lg">+{SPORTS.length - FEATURED_SPORTS.length}</span>
          }
        />
      </div>

      {banner && (
        <Link
          to={`/match/${banner.id}`}
          className="flex items-center gap-4 rounded-lg bg-accent2-700 px-5 py-4 text-accent2-100"
        >
          <div className="flex flex-1 flex-col gap-1">
            <span className="font-heading text-xl text-bg">
              Open match {bannerWhen(banner.startsAt)}
            </span>
            <span className="text-base">
              {banner.slotsTotal - banner.players.length} slot kosong · {SPORT_LABEL[banner.sport]}{' '}
              · {formatHour(banner.startsAt)}
            </span>
          </div>
          <span className="rounded-pill bg-accent2-100 px-4 py-2.5 font-heading text-base text-accent2-800">
            Gabung
          </span>
        </Link>
      )}

      <div className="flex flex-col gap-3.5">
        <SectionHeading
          title="Dekat kamu"
          action={
            <Link to="/search" className="text-base font-semibold text-accent-700">
              Lihat semua
            </Link>
          }
        />
        <AsyncList
          isLoading={venues.isLoading}
          error={venues.error}
          data={venues.data?.slice(0, 4)}
          onRetry={() => void venues.refetch()}
          skeleton={<ListSkeleton count={3} />}
          empty={
            <EmptyState
              title="Belum ada venue"
              body="Kami belum menemukan lapangan di sekitar lokasi ini."
            />
          }
        >
          {(rows) => (
            <div className="flex flex-col gap-3.5">
              {rows.map((venue) => (
                <VenueCard key={venue.id} venue={venue} />
              ))}
            </div>
          )}
        </AsyncList>
      </div>
    </>
  )
}

function bannerWhen(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (!sameDay) return 'minggu ini'
  return d.getHours() >= 17 ? 'malam ini' : 'hari ini'
}

/* ── 13 · Home v2: banner carousel + menu grid 4 ikon ───────────────────── */

const MENU = [
  { to: '/match', label: 'Cari lawan', icon: Swords, tone: 'accent' as const },
  { to: '/tournaments', label: 'Turnamen', icon: Trophy, tone: 'sage' as const },
  { to: '/team/t-smash', label: 'Tim', icon: Users, tone: 'accent' as const },
  { to: '/search', label: 'Venue', icon: MapPin, tone: 'sage' as const },
]

function CommunityHome() {
  const matches = useOpenMatches(null)

  return (
    <>
      {/* Banner carousel — scroll-snap horizontal, tanpa library. */}
      <div
        className="row-scroll -mx-5 flex snap-x snap-mandatory gap-3 px-5"
        aria-label="Promo dan info"
      >
        {BANNERS.map((banner) => (
          <article
            key={banner.title}
            className="flex w-[280px] shrink-0 snap-start flex-col gap-2 rounded-lg p-5"
            style={{ background: `var(${banner.bg})`, color: `var(${banner.fg})` }}
          >
            <Chip tone={banner.chipTone}>{banner.kicker}</Chip>
            <h3 className="text-xl" style={{ color: `var(${banner.fg})` }}>
              {banner.title}
            </h3>
            <p className="text-base opacity-90">{banner.body}</p>
          </article>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-3">
        {MENU.map(({ to, label, icon, tone }) => (
          <Link key={to} to={to} className="flex flex-col items-center gap-2">
            <span
              className={
                tone === 'accent'
                  ? 'flex aspect-square w-full items-center justify-center rounded-lg bg-accent-200 text-accent-800'
                  : 'flex aspect-square w-full items-center justify-center rounded-lg bg-accent2-200 text-accent2-800'
              }
            >
              <Icon icon={icon} size={24} />
            </span>
            <span className="text-sm font-semibold">{label}</span>
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-3.5">
        <SectionHeading
          title="Open match"
          action={
            <Link to="/match" className="text-base font-semibold text-accent-700">
              Lihat semua
            </Link>
          }
        />
        <AsyncList
          isLoading={matches.isLoading}
          error={matches.error}
          data={matches.data?.slice(0, 3)}
          onRetry={() => void matches.refetch()}
          skeleton={<RowSkeleton count={3} />}
          empty={
            <EmptyState
              title="Belum ada open match"
              body="Belum ada yang buka sesi terbuka di sekitarmu hari ini."
            />
          }
        >
          {(rows) => (
            <div className="flex flex-col gap-3.5">
              {rows.map((match) => (
                <OpenMatchCard key={match.id} match={match} />
              ))}
            </div>
          )}
        </AsyncList>
      </div>

      <div className="flex flex-col gap-3.5">
        <SectionHeading
          title="Turnamen"
          action={
            <Link
              to="/tournaments"
              className="inline-flex items-center gap-1 text-base font-semibold text-accent-700"
            >
              Semua
              <Icon icon={ChevronRight} size={15} />
            </Link>
          }
        />
        <Link to="/tournaments" className="flex gap-3.5 rounded-lg bg-surface p-3.5">
          <VenuePhoto
            photo={{ tone: 'accent', step: 300, seed: 51 }}
            className="h-[72px] w-[72px] shrink-0"
          />
          <div className="flex flex-1 flex-col gap-1.5">
            <h3 className="text-xl">Lapangin Cup</h3>
            <p className="text-base text-neutral-700">Badminton ganda · GOR Cendana</p>
            <Chip tone="sage">Buka pendaftaran</Chip>
          </div>
        </Link>
      </div>
    </>
  )
}

const BANNERS = [
  {
    kicker: 'Baru',
    title: 'Jadwal berulang',
    body: 'Kunci slot favorit tiap minggu sekali atur, langsung aman 4 minggu.',
    bg: '--color-accent-2-700',
    fg: '--color-accent-2-100',
    chipTone: 'sage' as const,
  },
  {
    kicker: 'Poin',
    title: 'Tukar poin jadi potongan',
    body: '100 poin = Rp10.000. Bisa dipakai sampai 30% dari subtotal.',
    bg: '--color-accent-700',
    fg: '--color-accent-100',
    chipTone: 'accent' as const,
  },
  {
    kicker: 'Komunitas',
    title: 'Split bill otomatis',
    body: 'Bagi biaya lapangan ke seluruh anggota, sisa pembulatan ke host.',
    bg: '--color-neutral-800',
    fg: '--color-neutral-100',
    chipTone: 'neutral' as const,
  },
]
