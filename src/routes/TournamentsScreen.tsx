import { useState } from 'react'
import clsx from 'clsx'
import type { TournamentStatus } from '@/types'
import { useMemberships, useRegisterTournament, useTournaments } from '@/hooks/queries'
import { Screen, ScreenHeader } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { Toast } from '@/components/ui/Toast'
import { useToast } from '@/hooks/useToast'
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
  const register = useRegisterTournament()
  const memberships = useMemberships()
  const { toast, show } = useToast()
  const registeredIds = memberships.data?.tournaments ?? []

  const rows = (tournaments.data ?? []).filter((t) => (tab === 'semua' ? true : t.status === tab))

  return (
    <Screen overlay={<Toast toast={toast} />}>
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
            {items.map((tournament) => {
              const registered = registeredIds.includes(tournament.id)
              const closed = tournament.status !== 'pendaftaran'
              const full = tournament.slotsTaken >= tournament.slotsTotal
              return (
                <li key={tournament.id}>
                  <TournamentCard
                    tournament={tournament}
                    action={
                      <Button
                        block
                        variant={registered ? 'secondary' : 'primary'}
                        disabled={registered || closed || full || register.isPending}
                        onClick={() =>
                          register.mutate(tournament.id, {
                            onSuccess: () => show(`Kamu terdaftar di ${tournament.name}.`),
                            onError: (error) => show(error.message, 'gagal'),
                          })
                        }
                      >
                        {registered
                          ? 'Sudah terdaftar'
                          : closed
                            ? 'Pendaftaran ditutup'
                            : full
                              ? 'Kuota penuh'
                              : 'Daftar'}
                      </Button>
                    }
                  />
                </li>
              )
            })}
          </ul>
        )}
      </AsyncList>
    </Screen>
  )
}
