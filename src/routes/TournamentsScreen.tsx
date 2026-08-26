import { useState } from 'react'
import clsx from 'clsx'
import type { TournamentStatus } from '@/types'
import { useTournaments } from '@/hooks/queries'
import { Screen, ScreenHeader } from '@/components/layout/Screen'
import { AsyncList, EmptyState, ListSkeleton } from '@/components/ui/states'
import { TournamentCard } from '@/components/domain/cards'

const TABS: { value: TournamentStatus | 'semua'; label: string }[] = [
  { value: 'semua', label: 'Semua' },
  { value: 'pendaftaran', label: 'Buka' },
  { value: 'berlangsung', label: 'Berlangsung' },
  { value: 'selesai', label: 'Selesai' },
]

/** 15 · Turnamen. */
export function TournamentsScreen() {
  const [tab, setTab] = useState<TournamentStatus | 'semua'>('semua')
  const tournaments = useTournaments()

  const rows = (tournaments.data ?? []).filter((t) => (tab === 'semua' ? true : t.status === tab))

  return (
    <Screen>
      <ScreenHeader title="Turnamen" />

      <div className="row-scroll -mx-5 flex gap-2 px-5" role="tablist" aria-label="Status turnamen">
        {TABS.map(({ value, label }) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={clsx(
              'min-h-touch shrink-0 rounded-pill px-4 text-base font-semibold transition-colors',
              tab === value
                ? 'bg-accent2-600 text-accent2-100'
                : 'border border-divider text-text hover:bg-neutral-200',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <AsyncList
        isLoading={tournaments.isLoading}
        error={tournaments.error}
        data={rows}
        onRetry={() => void tournaments.refetch()}
        skeleton={<ListSkeleton count={3} />}
        empty={
          <EmptyState
            title="Belum ada turnamen"
            body="Belum ada turnamen dengan status ini. Coba tab lain."
          />
        }
      >
        {(items) => (
          <ul className="flex flex-col gap-4">
            {items.map((tournament) => (
              <li key={tournament.id}>
                <TournamentCard tournament={tournament} />
              </li>
            ))}
          </ul>
        )}
      </AsyncList>
    </Screen>
  )
}
