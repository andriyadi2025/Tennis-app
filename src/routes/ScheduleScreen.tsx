import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { Repeat } from 'lucide-react'
import type { Slot } from '@/types'
import { useRecurrenceCheck, useSlots, useVenue } from '@/hooks/queries'
import { useDraftStore } from '@/store/draft'
import { describeSelection, toggleSlot } from '@/lib/slots'
import type { SelectionError } from '@/lib/slots'
import { computePrice } from '@/lib/pricing'
import {
  dateStrip,
  dayKey,
  formatDateShort,
  formatDayOfMonth,
  formatHour,
  formatWeekdayLong,
  formatWeekdayShort,
  parseISO,
} from '@/lib/dates'
import { formatIdr } from '@/lib/money'
import { Screen, ScreenHeader, StickyBar } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Toggle, ToggleChip } from '@/components/ui/primitives'
import { ErrorState, GridSkeleton, SkeletonBlock } from '@/components/ui/states'

const RECURRENCE_WEEKS = 4

/** 05 · Pilih lapangan & jam. */
export function ScheduleScreen() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const venue = useVenue(id)

  const draft = useDraftStore()
  const [selectionError, setSelectionError] = useState<SelectionError | null>(null)

  const days = useMemo(() => dateStrip(new Date(), 14), [])
  const activeDate = draft.date ? parseISO(draft.date) : (days[0] ?? new Date())
  const activeCourtId = draft.courtId ?? venue.data?.courts[0]?.id
  const activeCourt = venue.data?.courts.find((c) => c.id === activeCourtId)

  // Draft menyimpan konteks; kalau layar dibuka langsung lewat URL, isi ulang.
  useEffect(() => {
    const data = venue.data
    const sport = data?.sport[0]
    if (!data || !sport) return
    if (draft.venueId !== data.id) draft.setVenue(data.id, data.name, sport)
    if (!draft.date) draft.setDate((days[0] ?? new Date()).toISOString())
    const first = data.courts[0]
    if (!draft.courtId && first) draft.setCourt(first.id, first.name)
    // Sengaja hanya bergantung pada data venue: sisanya aksi store yang stabil.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue.data])

  const slots = useSlots(id, activeCourtId, activeDate)
  const recurrenceCheck = useRecurrenceCheck()

  const selected = draft.startsAt
  const selectedSlots = (slots.data ?? []).filter((s) => selected.includes(s.startsAt))
  const weeks = draft.recurrenceWeeks
  const price = computePrice({ slots: selectedSlots, weeks })

  function onToggle(slot: Slot) {
    const result = toggleSlot(selected, slot.startsAt, slots.data ?? [])
    setSelectionError(result.error)
    if (!result.error) draft.setSelection(result.selected)
  }

  function onRecurrenceChange(next: boolean) {
    const nextWeeks = next ? RECURRENCE_WEEKS : 1
    draft.setRecurrenceWeeks(nextWeeks)
    recurrenceCheck.reset()
    if (next && activeCourtId && selected.length > 0) {
      // Jadwal berulang hanya berarti kalau semua minggu ke depan benar kosong.
      recurrenceCheck.mutate({ courtId: activeCourtId, startsAt: selected, weeks: nextWeeks })
    }
  }

  const conflicts = recurrenceCheck.data?.conflicts ?? []
  const hasConflict = weeks > 1 && conflicts.length > 0

  if (venue.error) {
    return (
      <Screen>
        <ScreenHeader title="Pilih jadwal" />
        <ErrorState body={venue.error.message} onRetry={() => void venue.refetch()} />
      </Screen>
    )
  }

  return (
    <Screen
      bottom={
        <StickyBar>
          <div className="flex flex-col">
            <span className="text-sm text-neutral-700">
              {selected.length > 0
                ? `${selected.length} jam · ${activeCourt?.name ?? ''}`
                : 'Belum ada jam dipilih'}
            </span>
            <span className="font-heading text-2xl text-accent-700">
              {formatIdr(price.subtotalIdr)}
            </span>
          </div>
          <Button
            size="lg"
            className="flex-1"
            disabled={selected.length === 0 || hasConflict}
            onClick={() => {
              draft.goToSummary()
              navigate('/booking/summary')
            }}
          >
            Lanjut
          </Button>
        </StickyBar>
      }
    >
      <ScreenHeader title="Pilih jadwal" />

      {/* Strip 14 hari */}
      <div className="row-scroll -mx-5 flex gap-2.5 px-5" role="group" aria-label="Pilih tanggal">
        {days.map((day) => {
          const isActive = dayKey(day) === dayKey(activeDate)
          return (
            <button
              key={day.toISOString()}
              type="button"
              aria-pressed={isActive}
              onClick={() => {
                draft.setDate(day.toISOString())
                setSelectionError(null)
                recurrenceCheck.reset()
              }}
              className={clsx(
                'flex w-[62px] shrink-0 flex-col items-center gap-0.5 rounded-md py-3',
                isActive ? 'bg-accent text-bg' : 'bg-surface text-text',
              )}
            >
              <span className={clsx('text-xs', isActive ? 'opacity-90' : 'text-neutral-700')}>
                {formatWeekdayShort(day)}
              </span>
              <span className="font-heading text-2xl">{formatDayOfMonth(day)}</span>
            </button>
          )
        })}
      </div>

      {/* Tab lapangan */}
      <div className="row-scroll -mx-5 flex gap-2 px-5" role="group" aria-label="Pilih lapangan">
        {venue.isLoading
          ? Array.from({ length: 4 }, (_, i) => (
              <SkeletonBlock key={i} className="h-11 w-24 rounded-pill" />
            ))
          : (venue.data?.courts ?? []).map((court) => (
              <ToggleChip
                key={court.id}
                active={court.id === activeCourtId}
                onClick={() => {
                  draft.setCourt(court.id, court.name)
                  setSelectionError(null)
                  recurrenceCheck.reset()
                }}
              >
                {court.name}
              </ToggleChip>
            ))}
      </div>

      <Legend />

      {/* Grid slot per jam */}
      <div className="flex flex-col gap-3">
        {slots.isLoading ? (
          <GridSkeleton count={12} />
        ) : slots.error ? (
          <ErrorState body={slots.error.message} onRetry={() => void slots.refetch()} />
        ) : (
          <div
            role="group"
            aria-label={`Jam tersedia ${formatDateShort(activeDate)}`}
            className="grid grid-cols-3 gap-2.5"
          >
            {(slots.data ?? []).map((slot) => {
              const isSelected = selected.includes(slot.startsAt)
              const isBooked = slot.status === 'booked'
              return (
                <button
                  key={slot.startsAt}
                  type="button"
                  disabled={isBooked}
                  aria-pressed={isSelected}
                  aria-label={`${formatHour(slot.startsAt)}, ${
                    isBooked ? 'penuh' : formatIdr(slot.priceIdr)
                  }`}
                  onClick={() => onToggle(slot)}
                  className={clsx(
                    'min-h-touch rounded-md text-md font-semibold transition-colors',
                    isBooked && 'bg-neutral-300 text-neutral-600 line-through',
                    !isBooked && isSelected && 'bg-accent font-bold text-bg',
                    !isBooked && !isSelected && 'bg-accent2-200 text-text hover:bg-accent2-300',
                  )}
                >
                  {formatHour(slot.startsAt)}
                </button>
              )
            })}
          </div>
        )}

        {/* Status pilihan dibacakan tanpa memindahkan fokus dari grid. */}
        <p
          aria-live="polite"
          className={clsx(
            'min-h-[20px] text-base',
            selectionError ? 'text-accent-700' : 'text-neutral-700',
          )}
        >
          {selectionError
            ? selectionError.message
            : selected.length > 0
              ? `Dipilih ${describeSelection(selected)} · ${formatIdr(price.courtIdr / Math.max(1, weeks))}`
              : 'Pilih satu atau beberapa jam yang bersambung.'}
        </p>
      </div>

      {/* Jadwal berulang */}
      <div className="flex flex-col gap-3">
        <Toggle
          checked={weeks > 1}
          onChange={onRecurrenceChange}
          label={`Ulangi tiap ${formatWeekdayLong(activeDate)}`}
          description={`Kunci slot ini ${RECURRENCE_WEEKS} minggu ke depan`}
          leading={
            <span className="flex h-11 w-11 items-center justify-center rounded-pill bg-accent2-300 text-accent2-800">
              <Icon icon={Repeat} size={20} />
            </span>
          }
        />

        <div aria-live="polite" className="flex flex-col gap-2">
          {weeks > 1 && recurrenceCheck.isPending && (
            <p className="text-base text-neutral-700">Mengecek minggu-minggu berikutnya…</p>
          )}
          {hasConflict && (
            <div role="alert" className="flex flex-col gap-2 rounded-lg bg-accent-100 p-4">
              <h3 className="text-xl text-accent-900">Ada jadwal yang bentrok</h3>
              <ul className="flex flex-col gap-1 text-base text-accent-800">
                {conflicts.map((c) => (
                  <li key={c.weekOffset}>
                    Minggu ke-{c.weekOffset + 1}: {c.startsAt.map((s) => formatHour(s)).join(', ')}{' '}
                    sudah terisi.
                  </li>
                ))}
              </ul>
              <Button variant="secondary" onClick={() => onRecurrenceChange(false)}>
                Booking sekali saja
              </Button>
            </div>
          )}
          {weeks > 1 && !recurrenceCheck.isPending && !hasConflict && recurrenceCheck.isSuccess && (
            <p className="text-base text-accent2-700">
              Semua {RECURRENCE_WEEKS} minggu ke depan masih kosong.
            </p>
          )}
        </div>
      </div>
    </Screen>
  )
}

function Legend() {
  const items = [
    { label: 'Tersedia', className: 'bg-accent2-400' },
    { label: 'Dipilih', className: 'bg-accent' },
    { label: 'Penuh', className: 'bg-neutral-300' },
  ]
  return (
    <ul className="flex items-center gap-4 text-sm text-neutral-700">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={clsx('h-3 w-3 rounded-pill', item.className)} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}
