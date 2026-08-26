import { useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Check, Clock, MapPin, X } from 'lucide-react'
import type { SparringInvite } from '@/types'
import { SPORT_LABEL } from '@/types'
import { useRespondSparring, useSparring } from '@/hooks/queries'
import { useToast } from '@/hooks/useToast'
import { formatDateShort, formatHour, formatRelative } from '@/lib/dates'
import { Screen, ScreenHeader } from '@/components/layout/Screen'
import { Button, LinkButton } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Toast } from '@/components/ui/Toast'
import { Avatar, Chip } from '@/components/ui/primitives'
import { AsyncList, EmptyState, RowSkeleton } from '@/components/ui/states'
import { SPORT_ICON } from '@/components/domain/sport'

type Box = 'masuk' | 'keluar'

/** Kotak ajakan sparring — masuk butuh jawaban, keluar sedang menunggu. */
export function SparringScreen() {
  const [box, setBox] = useState<Box>('masuk')
  const invites = useSparring()
  const { toast, show } = useToast()

  const rows = (invites.data ?? []).filter((s) => s.direction === box)
  const waiting = (invites.data ?? []).filter(
    (s) => s.direction === 'masuk' && s.status === 'menunggu',
  ).length

  return (
    <Screen overlay={<Toast toast={toast} />}>
      <ScreenHeader title="Ajakan sparring" />

      <div
        role="tablist"
        aria-label="Kotak ajakan"
        className="flex gap-1 rounded-pill bg-surface p-1"
      >
        {(
          [
            ['masuk', 'Masuk'],
            ['keluar', 'Terkirim'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={box === value}
            onClick={() => setBox(value)}
            className={clsx(
              'min-h-touch flex-1 rounded-pill px-4 font-heading text-md',
              box === value ? 'bg-accent text-bg' : 'text-neutral-700',
            )}
          >
            {label}
            {value === 'masuk' && waiting > 0 && ` (${waiting})`}
          </button>
        ))}
      </div>

      <AsyncList
        isLoading={invites.isLoading}
        error={invites.error}
        data={rows}
        onRetry={() => void invites.refetch()}
        skeleton={<RowSkeleton count={3} />}
        empty={
          box === 'masuk' ? (
            <EmptyState
              title="Belum ada ajakan masuk"
              body="Tim lain yang mengajak sparring akan muncul di sini."
            />
          ) : (
            <EmptyState
              title="Belum ada ajakan terkirim"
              body="Ajak tim lain dari halaman tim mereka."
              action={
                <LinkButton to="/match" variant="secondary">
                  Cari tim
                </LinkButton>
              }
            />
          )
        }
      >
        {(items) => (
          <ul className="flex flex-col gap-3.5">
            {items.map((invite) => (
              <li key={invite.id}>
                <InviteCard invite={invite} onDone={show} />
              </li>
            ))}
          </ul>
        )}
      </AsyncList>
    </Screen>
  )
}

const STATUS_TONE = {
  menunggu: 'accent',
  diterima: 'sage',
  ditolak: 'neutral',
} as const

const STATUS_LABEL = {
  menunggu: 'Menunggu jawaban',
  diterima: 'Diterima',
  ditolak: 'Ditolak',
} as const

function InviteCard({
  invite,
  onDone,
}: {
  invite: SparringInvite
  onDone: (message: string, tone?: 'sukses' | 'gagal') => void
}) {
  const respond = useRespondSparring()
  const other = invite.direction === 'masuk' ? invite.fromTeamName : invite.toTeamName
  const pending = invite.status === 'menunggu'

  return (
    <article className="flex flex-col gap-3 rounded-lg bg-surface p-4">
      <div className="flex items-start gap-3">
        <Avatar name={other} size={44} tone={invite.direction === 'masuk' ? 'accent' : 'neutral'} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="truncate text-xl">{other}</h3>
          <p className="text-base text-neutral-700">
            {invite.direction === 'masuk' ? 'Mengajak sparring' : 'Kamu mengajak'} ·{' '}
            {formatRelative(invite.createdAt)}
          </p>
        </div>
        <Chip tone={STATUS_TONE[invite.status]}>{STATUS_LABEL[invite.status]}</Chip>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-base text-neutral-700">
        <span className="inline-flex items-center gap-1.5">
          <Icon icon={SPORT_ICON[invite.sport]} size={14} />
          {SPORT_LABEL[invite.sport]}
        </span>
        {invite.proposedAt ? (
          <span className="inline-flex items-center gap-1.5">
            <Icon icon={Clock} size={14} />
            {formatDateShort(invite.proposedAt)} · {formatHour(invite.proposedAt)}
          </span>
        ) : (
          <span className="text-neutral-600">Waktu belum ditentukan</span>
        )}
        {invite.venueName && (
          <span className="inline-flex items-center gap-1.5">
            <Icon icon={MapPin} size={14} />
            {invite.venueName}
          </span>
        )}
      </div>

      <p className="text-base">{invite.message}</p>

      {invite.direction === 'masuk' && pending && (
        <div className="flex gap-3">
          <Button
            variant="secondary"
            block
            disabled={respond.isPending}
            onClick={() =>
              respond.mutate(
                { id: invite.id, accept: false },
                {
                  onSuccess: () => onDone(`Ajakan ${other} ditolak.`),
                  onError: (error) => onDone(error.message, 'gagal'),
                },
              )
            }
          >
            <Icon icon={X} size={16} />
            Tolak
          </Button>
          <Button
            block
            disabled={respond.isPending}
            onClick={() =>
              respond.mutate(
                { id: invite.id, accept: true },
                {
                  onSuccess: () => onDone(`Sparring dengan ${other} disetujui.`),
                  onError: (error) => onDone(error.message, 'gagal'),
                },
              )
            }
          >
            <Icon icon={Check} size={16} />
            Terima
          </Button>
        </div>
      )}

      {invite.status === 'diterima' && (
        <Link
          to={`/venue/${invite.sport === 'badminton' ? 'v-cendana' : 'v-arenabuahbatu'}/schedule`}
          className="text-base font-semibold text-accent-700"
        >
          Booking lapangannya
        </Link>
      )}
    </article>
  )
}
