import { Link, useSearchParams } from 'react-router-dom'
import type { Sport } from '@/types'
import { SPORTS, SPORT_LABEL } from '@/types'
import { useOpenMatches, useSparring, useTeams } from '@/hooks/queries'
import { Screen, SectionHeading } from '@/components/layout/Screen'
import { Swords } from 'lucide-react'
import { LinkButton } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Chip, ToggleChip } from '@/components/ui/primitives'
import { AsyncList, EmptyState, ListSkeleton, RowSkeleton } from '@/components/ui/states'
import { OpenMatchCard, TeamCard } from '@/components/domain/cards'

/** 14 · Cari lawan / sparring. */
export function MatchScreen() {
  const [params, setParams] = useSearchParams()
  const sportParam = params.get('sport')
  const sport = SPORTS.includes(sportParam as Sport) ? (sportParam as Sport) : null

  const matches = useOpenMatches(sport)
  const teams = useTeams()
  const sparring = useSparring()
  const waiting = (sparring.data ?? []).filter(
    (s) => s.direction === 'masuk' && s.status === 'menunggu',
  ).length

  function setSport(next: Sport | null) {
    const search = new URLSearchParams(params)
    if (next) search.set('sport', next)
    else search.delete('sport')
    setParams(search, { replace: true })
  }

  return (
    <Screen>
      <SectionHeading
        title="Cari lawan"
        action={
          <Link to="/tournaments" className="text-base font-semibold text-accent-700">
            Turnamen
          </Link>
        }
      />
      <p className="text-base text-neutral-700">
        Gabung open match yang kurang orang, atau ajak tim lain sparring.
      </p>

      <Link
        to="/sparring"
        className="flex min-h-touch items-center gap-3.5 rounded-lg bg-surface px-4 py-3"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-accent2-200 text-accent2-800">
          <Icon icon={Swords} size={18} />
        </span>
        <span className="flex flex-1 flex-col">
          <span className="text-base font-bold">Ajakan sparring</span>
          <span className="text-sm text-neutral-700">
            {waiting > 0 ? `${waiting} ajakan menunggu jawaban` : 'Tidak ada yang menunggu'}
          </span>
        </span>
        {waiting > 0 && <Chip tone="accent">{waiting}</Chip>}
      </Link>

      <div className="row-scroll -mx-5 flex gap-2 px-5">
        <ToggleChip active={sport === null} onClick={() => setSport(null)}>
          Semua
        </ToggleChip>
        {SPORTS.map((s) => (
          <ToggleChip key={s} active={sport === s} onClick={() => setSport(sport === s ? null : s)}>
            {SPORT_LABEL[s]}
          </ToggleChip>
        ))}
      </div>

      <section className="flex flex-col gap-3.5">
        <h2 className="text-3xl">Open match</h2>
        <AsyncList
          isLoading={matches.isLoading}
          error={matches.error}
          data={matches.data}
          onRetry={() => void matches.refetch()}
          skeleton={<ListSkeleton count={3} />}
          empty={
            <EmptyState
              title="Belum ada open match"
              body={
                sport
                  ? `Belum ada sesi ${SPORT_LABEL[sport].toLowerCase()} yang terbuka. Coba cabang lain.`
                  : 'Belum ada sesi terbuka. Kamu bisa buat sendiri dari booking yang sudah ada.'
              }
              action={
                <LinkButton to="/search" variant="secondary">
                  Buat sesi baru
                </LinkButton>
              }
            />
          }
        >
          {(rows) => (
            <ul className="flex flex-col gap-3.5">
              {rows.map((match) => (
                <li key={match.id}>
                  <OpenMatchCard match={match} />
                </li>
              ))}
            </ul>
          )}
        </AsyncList>
      </section>

      {/* 16 · Tim & komunitas — daftar; detailnya di /team/:id */}
      <section className="flex flex-col gap-3.5">
        <h2 className="text-3xl">Tim & komunitas</h2>
        <AsyncList
          isLoading={teams.isLoading}
          error={teams.error}
          data={teams.data?.filter((t) => (sport ? t.sport === sport : true))}
          onRetry={() => void teams.refetch()}
          skeleton={<RowSkeleton count={2} />}
          empty={
            <EmptyState
              title="Belum ada tim"
              body="Belum ada komunitas untuk cabang ini di kotamu."
            />
          }
        >
          {(rows) => (
            <ul className="flex flex-col gap-3.5">
              {rows.map((team) => (
                <li key={team.id}>
                  <TeamCard team={team} />
                </li>
              ))}
            </ul>
          )}
        </AsyncList>
      </section>
    </Screen>
  )
}
