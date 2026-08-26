import { useParams } from 'react-router-dom'
import { Clock, MapPin, MessageCircle, Plus, Users } from 'lucide-react'
import { LEVEL_LABEL, SPORT_LABEL } from '@/types'
import { useJoinMatch, useMe, useOpenMatch } from '@/hooks/queries'
import { formatDateLong, formatHour } from '@/lib/dates'
import { formatIdr } from '@/lib/money'
import { Screen, ScreenHeader, StickyBar } from '@/components/layout/Screen'
import { Button, LinkButton } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Avatar, Chip, ProgressBar } from '@/components/ui/primitives'
import { ErrorState, SkeletonBlock } from '@/components/ui/states'
import { Toast } from '@/components/ui/Toast'
import { useToast } from '@/hooks/useToast'
import { SPORT_ICON } from '@/components/domain/sport'

/** 17 · Detail open match — slot pemain kosong. */
export function MatchDetailScreen() {
  const { id } = useParams<{ id: string }>()
  const match = useOpenMatch(id)
  const join = useJoinMatch(id)
  const { data: me } = useMe()
  const { toast, show } = useToast()

  if (match.isLoading) {
    return (
      <Screen>
        <ScreenHeader title="Open match" />
        <SkeletonBlock className="h-28 w-full rounded-lg" />
        <SkeletonBlock className="h-48 w-full rounded-lg" />
      </Screen>
    )
  }

  if (match.error || !match.data) {
    return (
      <Screen>
        <ScreenHeader title="Open match" />
        <ErrorState
          body={match.error?.message ?? 'Open match tidak ditemukan.'}
          onRetry={() => void match.refetch()}
        />
      </Screen>
    )
  }

  const data = match.data
  const open = data.slotsTotal - data.players.length
  const full = open <= 0
  const joined = data.players.some((p) => p.id === me?.id)

  function onJoinToggle() {
    join.mutate(joined ? 'leave' : 'join', {
      onSuccess: () =>
        show(joined ? 'Kamu keluar dari sesi ini.' : 'Berhasil gabung. Sampai ketemu di lapangan.'),
      onError: (error) => show(error.message, 'gagal'),
    })
  }

  return (
    <Screen
      overlay={<Toast toast={toast} />}
      bottom={
        <StickyBar>
          <div className="flex flex-col">
            <span className="text-sm text-neutral-700">Per orang</span>
            <span className="font-heading text-2xl text-accent-700">
              {formatIdr(data.pricePerPersonIdr)}
            </span>
          </div>
          <Button
            size="lg"
            className="flex-1"
            variant={joined ? 'secondary' : 'primary'}
            disabled={(full && !joined) || join.isPending}
            onClick={onJoinToggle}
          >
            {join.isPending
              ? 'Memproses…'
              : joined
                ? 'Batal gabung'
                : full
                  ? 'Slot penuh'
                  : 'Gabung sekarang'}
          </Button>
        </StickyBar>
      }
    >
      <ScreenHeader title="Open match" />

      <section className="flex flex-col gap-3.5 rounded-lg bg-surface p-4">
        <div className="flex items-start gap-3.5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-pill bg-accent2-200 text-accent2-800">
            <Icon icon={SPORT_ICON[data.sport]} size={22} />
          </span>
          <div className="flex flex-1 flex-col gap-1">
            <h1 className="text-2xl">{data.title}</h1>
            <div className="flex flex-wrap gap-2">
              <Chip tone="sage">{SPORT_LABEL[data.sport]}</Chip>
              <Chip tone="accent">{LEVEL_LABEL[data.level]}</Chip>
            </div>
          </div>
        </div>

        <dl className="flex flex-col gap-2 text-base">
          <div className="flex items-center gap-2.5">
            <Icon icon={Clock} size={16} className="text-neutral-600" />
            <dt className="sr-only">Waktu</dt>
            <dd>
              {formatDateLong(data.startsAt)} · {formatHour(data.startsAt)} ({data.hours} jam)
            </dd>
          </div>
          <div className="flex items-center gap-2.5">
            <Icon icon={MapPin} size={16} className="text-neutral-600" />
            <dt className="sr-only">Lokasi</dt>
            <dd>
              {data.venueName} · {data.district}
            </dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-3xl">Pemain</h2>
          <span className="text-base text-neutral-700">
            {data.players.length}/{data.slotsTotal} terisi
          </span>
        </div>

        <ProgressBar
          ratio={data.players.length / data.slotsTotal}
          tone={full ? 'accent' : 'sage'}
          label={`${data.players.length} dari ${data.slotsTotal} pemain`}
        />

        {/* Slot terisi + slot kosong, ditampilkan dalam satu grid. */}
        <ul className="grid grid-cols-2 gap-2.5">
          {data.players.map((player) => (
            <li
              key={player.id}
              className="flex items-center gap-2.5 rounded-md bg-surface px-3 py-2.5"
            >
              <Avatar name={player.name} size={34} tone="neutral" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-base font-semibold">{player.name}</span>
                <span className="text-sm text-neutral-600">{LEVEL_LABEL[player.level]}</span>
              </div>
            </li>
          ))}
          {Array.from({ length: Math.max(0, open) }, (_, i) => (
            <li
              key={`empty-${i}`}
              className="flex items-center gap-2.5 rounded-md border-2 border-dashed border-neutral-400 px-3 py-2.5"
            >
              <span
                aria-hidden
                className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-pill bg-neutral-200 text-neutral-600"
              >
                <Icon icon={Plus} size={16} />
              </span>
              <span className="text-base text-neutral-600">Slot kosong</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-3xl">Catatan host</h2>
        <div className="flex flex-col gap-2.5 rounded-lg bg-surface p-4">
          <div className="flex items-center gap-2.5">
            <Avatar name={data.hostName} size={36} tone="accent" />
            <div className="flex flex-col">
              <span className="text-base font-semibold">{data.hostName}</span>
              <span className="text-sm text-neutral-600">Host</span>
            </div>
          </div>
          <p className="text-base">{data.note}</p>
        </div>
      </section>

      <div className="flex gap-3">
        <LinkButton to={`/chat/${data.chatId}`} variant="secondary" block>
          <Icon icon={MessageCircle} size={16} />
          Obrolan grup
        </LinkButton>
        <LinkButton to={`/venue/${data.venueId}`} variant="secondary" block>
          <Icon icon={Users} size={16} />
          Lihat venue
        </LinkButton>
      </div>
    </Screen>
  )
}
