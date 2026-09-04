import { useState } from 'react'
import clsx from 'clsx'
import type { PaymentMethod, Tournament, TournamentStatus } from '@/types'
import { PAYMENT_LABEL } from '@/types'
import {
  useMemberships,
  useRegisterTournament,
  useRegistrations,
  useTournaments,
} from '@/hooks/queries'
import { useToast } from '@/hooks/useToast'
import { formatIdr } from '@/lib/money'
import { formatDateLong } from '@/lib/dates'
import { Screen, ScreenHeader } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { Toast } from '@/components/ui/Toast'
import { Chip } from '@/components/ui/primitives'
import { AsyncList, EmptyState, ListSkeleton } from '@/components/ui/states'
import { TournamentCard } from '@/components/domain/cards'
import { PaymentMethodPicker } from '@/components/domain/PaymentMethodPicker'

const TABS: { value: TournamentStatus | 'semua'; label: string }[] = [
  { value: 'semua', label: 'Semua' },
  { value: 'pendaftaran', label: 'Buka' },
  { value: 'berlangsung', label: 'Berlangsung' },
  { value: 'selesai', label: 'Selesai' },
]

/** 15 · Turnamen. */
export function TournamentsScreen() {
  const [tab, setTab] = useState<TournamentStatus | 'semua'>('semua')
  const [paying, setPaying] = useState<Tournament | null>(null)
  const tournaments = useTournaments()
  const memberships = useMemberships()
  const registrations = useRegistrations()
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
              const registration = registrations.data?.find((r) => r.tournamentId === tournament.id)
              const registered = registeredIds.includes(tournament.id)
              const closed = tournament.status !== 'pendaftaran'
              const full = tournament.slotsTaken >= tournament.slotsTotal
              return (
                <li key={tournament.id}>
                  <TournamentCard
                    tournament={tournament}
                    action={
                      registered ? (
                        <div className="flex flex-col gap-2 rounded-md bg-bg p-3.5">
                          <div className="flex items-center gap-2">
                            <span className="flex-1 text-base font-bold">Kamu sudah terdaftar</span>
                            <Chip
                              tone={registration?.paymentStatus === 'lunas' ? 'sage' : 'accent'}
                            >
                              {registration?.paymentStatus === 'lunas'
                                ? 'Lunas'
                                : 'Bayar di tempat'}
                            </Chip>
                          </div>
                          {registration && (
                            <span className="text-sm text-neutral-700">
                              Kode {registration.code} · {PAYMENT_LABEL[registration.paymentMethod]}
                            </span>
                          )}
                        </div>
                      ) : (
                        <Button
                          block
                          disabled={closed || full}
                          onClick={() => setPaying(tournament)}
                        >
                          {closed
                            ? 'Pendaftaran ditutup'
                            : full
                              ? 'Kuota penuh'
                              : `Daftar · ${formatIdr(tournament.entryFeeIdr)}`}
                        </Button>
                      )
                    }
                  />
                </li>
              )
            })}
          </ul>
        )}
      </AsyncList>

      {paying && (
        <EntryFeeSheet
          tournament={paying}
          onClose={() => setPaying(null)}
          onPaid={(message) => {
            setPaying(null)
            show(message)
          }}
          onFailed={(message) => show(message, 'gagal')}
        />
      )}
    </Screen>
  )
}

/**
 * Biaya daftar ditagih sebelum kuota bergerak. Tanpa ini, "Daftar" hanya
 * menaikkan angka dan turnamen berbayar tampak gratis.
 */
function EntryFeeSheet({
  tournament,
  onClose,
  onPaid,
  onFailed,
}: {
  tournament: Tournament
  onClose: () => void
  onPaid: (message: string) => void
  onFailed: (message: string) => void
}) {
  const [method, setMethod] = useState<PaymentMethod>('qris')
  const register = useRegisterTournament()

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Bayar biaya daftar ${tournament.name}`}
      className="sheet-backdrop absolute inset-0 z-20 flex flex-col justify-end"
    >
      {/* Ketuk latar untuk menutup — jalan keluar yang tidak perlu dicari. */}
      <button
        type="button"
        aria-label="Tutup"
        className="flex-1 cursor-default"
        onClick={onClose}
      />
      <div className="scroll-area flex max-h-[82%] flex-col gap-5 rounded-t-lg bg-bg px-5 pb-5 pt-6">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-3xl">Biaya daftar</h2>
          <p className="text-base text-neutral-700">
            {tournament.name} · {formatDateLong(tournament.startsAt)}
          </p>
        </div>

        <dl className="flex flex-col gap-2.5 rounded-lg bg-surface p-4 text-base">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-neutral-700">Biaya daftar</dt>
            <dd className="font-semibold">{formatIdr(tournament.entryFeeIdr)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-neutral-700">Sisa kuota</dt>
            <dd className="font-semibold">
              {tournament.slotsTotal - tournament.slotsTaken} peserta
            </dd>
          </div>
          <div className="h-px bg-divider" />
          <div className="flex items-baseline justify-between">
            <dt className="text-md font-bold">Total</dt>
            <dd className="font-heading text-2xl text-accent-700">
              {formatIdr(tournament.entryFeeIdr)}
            </dd>
          </div>
        </dl>

        <div className="flex flex-col gap-3">
          <h3 className="text-xl">Metode pembayaran</h3>
          <PaymentMethodPicker
            name="tournament-payment"
            value={method}
            onChange={setMethod}
            compact
            disabled={register.isPending}
          />
        </div>

        <div className="flex gap-3">
          <Button variant="secondary" block onClick={onClose} disabled={register.isPending}>
            Batal
          </Button>
          <Button
            block
            disabled={register.isPending}
            onClick={() =>
              register.mutate(
                { id: tournament.id, method },
                {
                  onSuccess: ({ registration }) =>
                    onPaid(
                      registration.paymentStatus === 'lunas'
                        ? `Pendaftaran lunas. Kode ${registration.code}.`
                        : `Terdaftar. Bayar ${formatIdr(registration.entryFeeIdr)} di lokasi.`,
                    ),
                  onError: (error) => onFailed(error.message),
                },
              )
            }
          >
            {register.isPending ? 'Memproses…' : 'Bayar & daftar'}
          </Button>
        </div>
      </div>
    </div>
  )
}
