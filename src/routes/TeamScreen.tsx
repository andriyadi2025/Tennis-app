import { useParams } from 'react-router-dom'
import { CalendarPlus, MapPin, Send, Swords } from 'lucide-react'
import { LEVEL_LABEL, SPORT_LABEL } from '@/types'
import { useTeam, useTeams } from '@/hooks/queries'
import { Screen, ScreenHeader } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Avatar, Chip, VenuePhoto } from '@/components/ui/primitives'
import { ErrorState, RowSkeleton, SkeletonBlock } from '@/components/ui/states'
import { TeamCard } from '@/components/domain/cards'

/** 16 · Tim & komunitas. */
export function TeamScreen() {
  const { id } = useParams<{ id: string }>()
  const team = useTeam(id)
  const others = useTeams()

  if (team.isLoading) {
    return (
      <Screen>
        <ScreenHeader title="Tim" />
        <SkeletonBlock className="h-40 w-full rounded-lg" />
        <RowSkeleton count={3} />
      </Screen>
    )
  }

  if (team.error || !team.data) {
    return (
      <Screen>
        <ScreenHeader title="Tim" />
        <ErrorState
          body={team.error?.message ?? 'Tim tidak ditemukan.'}
          onRetry={() => void team.refetch()}
        />
      </Screen>
    )
  }

  const data = team.data
  const played = data.wins + data.losses
  const winRate = played === 0 ? 0 : Math.round((data.wins / played) * 100)

  return (
    <Screen>
      <ScreenHeader title={data.name} />

      <section className="flex flex-col items-center gap-3 rounded-lg bg-surface p-5 text-center">
        <VenuePhoto photo={data.photo} className="h-20 w-20" rounded="rounded-pill" />
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl">{data.name}</h1>
          <span className="inline-flex items-center justify-center gap-1.5 text-base text-neutral-700">
            <Icon icon={MapPin} size={14} />
            {data.city} · {SPORT_LABEL[data.sport]}
          </span>
        </div>
        <p className="max-w-[34ch] text-base text-neutral-700">{data.about}</p>

        <dl className="flex w-full justify-around pt-1">
          <Stat label="Menang" value={String(data.wins)} />
          <Stat label="Kalah" value={String(data.losses)} />
          <Stat label="Win rate" value={`${winRate}%`} />
        </dl>
      </section>

      <div className="flex gap-3">
        <Button block>
          <Icon icon={Swords} size={16} />
          Ajak sparring
        </Button>
        <Button variant="secondary" block>
          <Icon icon={Send} size={16} />
          Gabung
        </Button>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-3xl">Anggota</h2>
          <span className="text-base text-neutral-700">{data.memberCount} orang</span>
        </div>
        <ul className="flex flex-col gap-2">
          {data.members.map((member) => (
            <li key={member.id} className="flex items-center gap-3 rounded-md bg-surface px-4 py-3">
              <Avatar name={member.name} size={38} tone="neutral" />
              <div className="flex flex-1 flex-col">
                <span className="text-base font-semibold">{member.name}</span>
                <span className="text-sm text-neutral-600">{LEVEL_LABEL[member.level]}</span>
              </div>
              <Chip tone="sage">Aktif</Chip>
            </li>
          ))}
        </ul>
        {data.memberCount > data.members.length && (
          <p className="text-base text-neutral-600">
            +{data.memberCount - data.members.length} anggota lain
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-3xl">Jadwal latihan</h2>
        <div className="flex items-center gap-3.5 rounded-lg bg-surface p-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-accent2-300 text-accent2-800">
            <Icon icon={CalendarPlus} size={20} />
          </span>
          <div className="flex flex-1 flex-col">
            <span className="text-base font-bold">Buat jadwal rutin</span>
            <span className="text-sm text-neutral-700">
              Kunci slot mingguan untuk seluruh anggota sekaligus.
            </span>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-3xl">Tim lain</h2>
        <ul className="flex flex-col gap-3.5">
          {(others.data ?? [])
            .filter((t) => t.id !== data.id)
            .map((t) => (
              <li key={t.id}>
                <TeamCard team={t} />
              </li>
            ))}
        </ul>
      </section>
    </Screen>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center">
      <dt className="order-2 text-sm text-neutral-600">{label}</dt>
      <dd className="order-1 font-heading text-2xl">{value}</dd>
    </div>
  )
}
