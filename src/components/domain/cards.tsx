import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Clock, MapPin, Users } from 'lucide-react'
import type { OpenMatch, Team, Tournament, Venue } from '@/types'
import { SPORT_LABEL } from '@/types'
import { formatDistance, formatIdrShort } from '@/lib/money'
import { formatDateShort, formatHour } from '@/lib/dates'
import { Icon } from '@/components/ui/Icon'
import { Avatar, Chip, ProgressBar, RatingValue, VenuePhoto } from '@/components/ui/primitives'
import { SPORT_ICON } from './sport'

export function VenueCard({ venue }: { venue: Venue }) {
  const photo = venue.photos[0]
  return (
    <Link
      to={`/venue/${venue.id}`}
      className="flex gap-3.5 rounded-lg bg-surface p-3.5 transition-colors hover:bg-neutral-200"
    >
      {photo && <VenuePhoto photo={photo} className="h-[92px] w-[92px] shrink-0" />}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="truncate text-xl">{venue.name}</h3>
        <p className="truncate text-base text-neutral-700">
          {venue.sport.map((s) => SPORT_LABEL[s]).join(' · ')} · {formatDistance(venue.distanceKm)}{' '}
          · {venue.courts.length} lapangan
        </p>
        <div className="mt-auto flex items-center gap-2.5">
          <RatingValue value={venue.rating} />
          <span className="font-heading text-lg text-accent-700">
            {formatIdrShort(venue.pricePerHourIdr)}
            <span className="font-body text-sm text-neutral-600">/jam</span>
          </span>
        </div>
      </div>
    </Link>
  )
}

export function OpenMatchCard({ match }: { match: OpenMatch }) {
  const open = match.slotsTotal - match.players.length
  return (
    <Link
      to={`/match/${match.id}`}
      className="flex flex-col gap-3 rounded-lg bg-surface p-4 transition-colors hover:bg-neutral-200"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-accent2-200 text-accent2-800">
          <Icon icon={SPORT_ICON[match.sport]} size={20} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="truncate text-xl">{match.title}</h3>
          <p className="truncate text-base text-neutral-700">
            {match.venueName} · {match.district}
          </p>
        </div>
        <Chip tone={open > 0 ? 'sage' : 'neutral'}>{open > 0 ? `${open} slot` : 'Penuh'}</Chip>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-base text-neutral-700">
        <span className="inline-flex items-center gap-1.5">
          <Icon icon={Clock} size={14} />
          {formatDateShort(match.startsAt)} · {formatHour(match.startsAt)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Icon icon={Users} size={14} />
          {match.players.length}/{match.slotsTotal}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <span className="flex -space-x-2">
          {match.players.slice(0, 4).map((p) => (
            <Avatar key={p.id} name={p.name} size={28} tone="neutral" />
          ))}
        </span>
        <span className="font-heading text-lg text-accent-700">
          {formatIdrShort(match.pricePerPersonIdr)}
          <span className="font-body text-sm text-neutral-600">/orang</span>
        </span>
      </div>
    </Link>
  )
}

const TOURNAMENT_TONE: Record<Tournament['status'], 'accent' | 'sage' | 'neutral'> = {
  pendaftaran: 'sage',
  berlangsung: 'accent',
  selesai: 'neutral',
}

const TOURNAMENT_LABEL: Record<Tournament['status'], string> = {
  pendaftaran: 'Buka pendaftaran',
  berlangsung: 'Berlangsung',
  selesai: 'Selesai',
}

export function TournamentCard({ tournament }: { tournament: Tournament }) {
  const ratio = tournament.slotsTaken / tournament.slotsTotal
  return (
    <article className="flex flex-col gap-3 rounded-lg bg-surface p-4">
      <VenuePhoto photo={tournament.photo} className="h-28 w-full" rounded="rounded-lg" />
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex-1 text-xl">{tournament.name}</h3>
        <Chip tone={TOURNAMENT_TONE[tournament.status]}>{TOURNAMENT_LABEL[tournament.status]}</Chip>
      </div>
      <p className="text-base text-neutral-700">
        {tournament.venueName} · {formatDateShort(tournament.startsAt)}
      </p>
      <dl className="flex gap-6">
        <div className="flex flex-col">
          <dt className="text-sm text-neutral-600">Hadiah</dt>
          <dd className="font-heading text-lg text-accent-700">
            {formatIdrShort(tournament.prizePoolIdr)}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-sm text-neutral-600">Biaya daftar</dt>
          <dd className="font-heading text-lg">{formatIdrShort(tournament.entryFeeIdr)}</dd>
        </div>
      </dl>
      <div className="flex flex-col gap-1.5">
        <ProgressBar
          ratio={ratio}
          tone={ratio >= 1 ? 'accent' : 'sage'}
          label={`Kuota ${tournament.slotsTaken} dari ${tournament.slotsTotal}`}
        />
        <span className="text-sm text-neutral-700">
          {tournament.slotsTaken}/{tournament.slotsTotal} peserta
        </span>
      </div>
    </article>
  )
}

export function TeamCard({ team }: { team: Team }) {
  return (
    <Link
      to={`/team/${team.id}`}
      className="flex gap-3.5 rounded-lg bg-surface p-3.5 transition-colors hover:bg-neutral-200"
    >
      <VenuePhoto
        photo={team.photo}
        className="h-[72px] w-[72px] shrink-0"
        rounded="rounded-pill"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="truncate text-xl">{team.name}</h3>
        <p className="truncate text-base text-neutral-700">
          {SPORT_LABEL[team.sport]} · {team.memberCount} anggota
        </p>
        <span className="inline-flex items-center gap-1.5 text-base text-neutral-700">
          <Icon icon={MapPin} size={14} />
          {team.city}
        </span>
      </div>
    </Link>
  )
}

/** Baris kategori bulat di Home. */
export function SportBubble({
  label,
  icon,
  tone,
  onClick,
  active = false,
}: {
  label: string
  icon: React.ReactNode
  tone: 'accent' | 'sage' | 'neutral'
  onClick: () => void
  active?: boolean
}) {
  const bg =
    tone === 'accent'
      ? 'bg-accent-200 text-accent-800'
      : tone === 'sage'
        ? 'bg-accent2-200 text-accent2-800'
        : 'bg-neutral-300 text-neutral-800'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex min-w-[62px] flex-1 flex-col items-center gap-2"
    >
      <span
        className={clsx(
          'flex aspect-square w-full items-center justify-center rounded-pill transition-shadow',
          bg,
          active && 'ring-2 ring-accent ring-offset-2 ring-offset-bg',
        )}
      >
        {icon}
      </span>
      <span className="text-sm font-semibold">{label}</span>
    </button>
  )
}
