import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Check, Minus, Plus, Sparkles, Users } from 'lucide-react'
import type { BookingPurpose, SplitParticipant } from '@/types'
import { PURPOSE_LABEL } from '@/types'
import { useAddOns, useClubSettings, useCreateBooking, useMe, useSlots } from '@/hooks/queries'
import { useDraftStore } from '@/store/draft'
import { computePrice } from '@/lib/pricing'
import { maxRedeemablePoints, pointsEarned, redeemPoints, REDEEM_STEP_POINTS } from '@/lib/points'
import { amountFor } from '@/lib/split'
import { describeSelection } from '@/lib/slots'
import { formatDateLong, parseISO } from '@/lib/dates'
import { formatIdr } from '@/lib/money'
import { Screen, ScreenHeader, StickyBar } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Avatar, Chip, TextField, Toggle, VenuePhoto } from '@/components/ui/primitives'
import { ErrorState } from '@/components/ui/states'

/** 06 · Ringkasan booking + split bill. */
export function SummaryScreen() {
  const navigate = useNavigate()
  const draft = useDraftStore()
  const { data: me } = useMe()
  const balance = me?.points ?? 0

  const addOns = useAddOns()
  const settings = useClubSettings()
  const activeDate = draft.date ? parseISO(draft.date) : new Date()
  const slots = useSlots(draft.venueId ?? undefined, draft.courtId ?? undefined, activeDate)
  const createBooking = useCreateBooking()

  const [splitOn, setSplitOn] = useState(draft.splitBill !== null)
  const [newName, setNewName] = useState('')

  const selectedSlots = (slots.data ?? []).filter((s) => draft.startsAt.includes(s.startsAt))
  const chosenAddOns = (addOns.data ?? [])
    .filter((a) => draft.addOnIds.includes(a.id))
    .map((a) => ({ ...a, qty: 1 }))

  const base = computePrice({
    slots: selectedSlots,
    addOns: chosenAddOns,
    weeks: draft.recurrenceWeeks,
  })
  const redeem = redeemPoints(draft.pointsRedeemed, balance, base.subtotalIdr)
  const price = computePrice({
    slots: selectedSlots,
    addOns: chosenAddOns,
    weeks: draft.recurrenceWeeks,
    discountIdr: redeem.discountIdr,
  })
  const maxPoints = maxRedeemablePoints(balance, base.subtotalIdr)

  // Jumlah orang berubah → nominal per orang ikut dihitung ulang.
  useEffect(() => {
    if (!splitOn) return
    const participants = draft.splitBill?.participants ?? defaultParticipants(me?.name)
    draft.setSplitParticipants(participants, price.totalIdr)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitOn, price.totalIdr])

  if (draft.startsAt.length === 0) return <Navigate to="/" replace />

  const split = splitOn ? draft.splitBill : null

  function addPerson() {
    const name = newName.trim()
    if (!name || !split) return
    const participants = [
      ...split.participants,
      { id: `sp-${Date.now().toString(36)}`, name, isHost: false },
    ]
    draft.setSplitParticipants(participants, price.totalIdr)
    setNewName('')
  }

  function removePerson(id: string) {
    if (!split) return
    draft.setSplitParticipants(
      split.participants.filter((p) => p.id !== id),
      price.totalIdr,
    )
  }

  function onContinue() {
    if (!draft.venueId || !draft.courtId) return
    createBooking.mutate(
      {
        venueId: draft.venueId,
        courtId: draft.courtId,
        startsAt: draft.startsAt,
        recurrenceWeeks: draft.recurrenceWeeks,
        addOnIds: draft.addOnIds,
        pointsRedeemed: redeem.points,
        purpose: draft.purpose,
      },
      {
        onSuccess: (booking) => {
          draft.attachBooking(booking)
          navigate('/booking/payment')
        },
      },
    )
  }

  return (
    <Screen
      bottom={
        <StickyBar>
          <div className="flex flex-col">
            <span className="text-sm text-neutral-700">Total bayar</span>
            <span className="font-heading text-2xl text-accent-700">
              {formatIdr(price.totalIdr)}
            </span>
          </div>
          <Button
            size="lg"
            className="flex-1"
            disabled={createBooking.isPending}
            onClick={onContinue}
          >
            {createBooking.isPending ? 'Menyiapkan…' : 'Bayar'}
          </Button>
        </StickyBar>
      }
    >
      <ScreenHeader title="Ringkasan" />

      {createBooking.error && (
        <ErrorState
          title={
            createBooking.error.message.includes('diambil') ? 'Slot keburu diambil' : 'Gagal lanjut'
          }
          body={createBooking.error.message}
          onRetry={onContinue}
        />
      )}

      {/* Detail booking */}
      <section className="flex flex-col gap-4 rounded-lg bg-surface p-4">
        <div className="flex gap-3.5">
          <VenuePhoto
            photo={{ tone: 'accent2', step: 300, seed: 11 }}
            className="h-16 w-16 shrink-0"
          />
          <div className="flex flex-1 flex-col gap-0.5">
            <h2 className="text-xl">{draft.venueName}</h2>
            <p className="text-base text-neutral-700">{draft.courtName}</p>
            {draft.recurrenceWeeks > 1 && (
              <Chip tone="sage" className="mt-1 self-start">
                Berulang {draft.recurrenceWeeks} minggu
              </Chip>
            )}
          </div>
        </div>
        <dl className="flex flex-col gap-2 text-base">
          <Row label="Tanggal" value={formatDateLong(activeDate)} />
          <Row label="Jam" value={describeSelection(draft.startsAt)} />
          <Row label="Durasi" value={`${draft.startsAt.length} jam`} />
        </dl>
      </section>

      {/* Tujuan booking — menentukan kegiatannya tercatat sebagai apa */}
      <section className="flex flex-col gap-3">
        <h2 className="text-3xl">Tujuan</h2>
        <p className="text-base text-neutral-700">
          Menentukan kegiatan ini tercatat sebagai apa di riwayat main kamu.
        </p>
        <div className="flex gap-2.5">
          {(Object.keys(PURPOSE_LABEL) as BookingPurpose[]).map((purpose) => (
            <button
              key={purpose}
              type="button"
              aria-pressed={draft.purpose === purpose}
              onClick={() => draft.setPurpose(purpose)}
              className={
                draft.purpose === purpose
                  ? 'flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 rounded-lg bg-accent px-4 py-3 text-bg'
                  : 'flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 rounded-lg bg-surface px-4 py-3'
              }
            >
              <span className="font-heading text-md">{PURPOSE_LABEL[purpose]}</span>
              <span className="text-sm opacity-80">
                +{settings.data?.activityPoints[purpose] ?? 0} poin
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Tambahan */}
      <section className="flex flex-col gap-3">
        <h2 className="text-3xl">Tambahan</h2>
        <ul className="flex flex-col gap-2.5">
          {(addOns.data ?? []).map((addOn) => {
            const active = draft.addOnIds.includes(addOn.id)
            return (
              <li key={addOn.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => draft.toggleAddOn(addOn.id)}
                  className="flex w-full min-h-touch items-center gap-3 rounded-md bg-surface px-4 py-3 text-left"
                >
                  <span
                    aria-hidden
                    className={
                      active
                        ? 'flex h-6 w-6 shrink-0 items-center justify-center rounded-pill bg-accent text-bg'
                        : 'flex h-6 w-6 shrink-0 rounded-pill border-2 border-neutral-400'
                    }
                  >
                    {active && <Icon icon={Check} size={14} />}
                  </span>
                  <span className="flex-1 text-base">{addOn.label}</span>
                  <span className="font-heading text-base">{formatIdr(addOn.priceIdr)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      {/* Poin loyalitas */}
      <section className="flex flex-col gap-3">
        <h2 className="text-3xl">Poin</h2>
        <div className="flex flex-col gap-3 rounded-lg bg-surface p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-pill bg-accent-200 text-accent-800">
              <Icon icon={Sparkles} size={20} />
            </span>
            <div className="flex flex-1 flex-col">
              <span className="text-md font-bold">Tukar poin</span>
              <span className="text-sm text-neutral-700">
                Saldo {balance.toLocaleString('id-ID')} poin · maks{' '}
                {maxPoints.toLocaleString('id-ID')} di booking ini
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Kurangi poin"
              disabled={redeem.points === 0}
              onClick={() => draft.setPointsRedeemed(redeem.points - REDEEM_STEP_POINTS)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-neutral-200 disabled:opacity-40"
            >
              <Icon icon={Minus} size={18} />
            </button>
            <div className="flex flex-1 flex-col items-center">
              <span className="font-heading text-2xl">{redeem.points.toLocaleString('id-ID')}</span>
              <span className="text-sm text-neutral-700">poin</span>
            </div>
            <button
              type="button"
              aria-label="Tambah poin"
              disabled={redeem.points >= maxPoints}
              onClick={() => draft.setPointsRedeemed(redeem.points + REDEEM_STEP_POINTS)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-neutral-200 disabled:opacity-40"
            >
              <Icon icon={Plus} size={18} />
            </button>
          </div>

          <p aria-live="polite" className="text-sm text-neutral-700">
            {redeem.points > 0
              ? `Potongan ${formatIdr(redeem.discountIdr)}.`
              : `Kelipatan ${REDEEM_STEP_POINTS} poin, maksimal 30% dari subtotal.`}
          </p>
        </div>
      </section>

      {/* Split bill */}
      <section className="flex flex-col gap-3">
        <h2 className="text-3xl">Split bill</h2>
        <Toggle
          checked={splitOn}
          onChange={(next) => {
            setSplitOn(next)
            if (!next) draft.setSplitBill(null)
          }}
          label="Bagi biaya"
          description="Tagihan dibagi rata, sisa pembulatan ke host."
          leading={
            <span className="flex h-11 w-11 items-center justify-center rounded-pill bg-accent2-300 text-accent2-800">
              <Icon icon={Users} size={20} />
            </span>
          }
        />

        {splitOn && split && (
          <div className="flex flex-col gap-3 rounded-lg bg-surface p-4">
            <ul className="flex flex-col gap-2.5">
              {split.participants.map((p) => (
                <li key={p.id} className="flex items-center gap-3">
                  <Avatar name={p.name} size={36} tone={p.isHost ? 'accent' : 'neutral'} />
                  <div className="flex flex-1 flex-col">
                    <span className="text-base font-semibold">{p.name}</span>
                    {p.isHost && <span className="text-sm text-neutral-600">Host</span>}
                  </div>
                  <span className="font-heading text-base">
                    {formatIdr(amountFor(split, p.id))}
                  </span>
                  {!p.isHost && (
                    <button
                      type="button"
                      aria-label={`Hapus ${p.name}`}
                      onClick={() => removePerson(p.id)}
                      className="flex h-9 w-9 items-center justify-center rounded-pill text-neutral-600"
                    >
                      <Icon icon={Minus} size={16} />
                    </button>
                  )}
                </li>
              ))}
            </ul>

            <div className="flex items-end gap-2.5">
              <div className="flex-1">
                <TextField
                  label="Tambah orang"
                  placeholder="Nama teman"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addPerson()
                    }
                  }}
                />
              </div>
              <Button onClick={addPerson} disabled={!newName.trim()}>
                <Icon icon={Plus} size={16} />
                Tambah
              </Button>
            </div>

            {split.hostRemainderIdr > 0 && (
              <p className="text-sm text-neutral-700">
                Sisa pembulatan {formatIdr(split.hostRemainderIdr)} ditanggung host.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Rincian harga */}
      <section className="flex flex-col gap-3">
        <h2 className="text-3xl">Rincian</h2>
        <dl className="flex flex-col gap-2.5 rounded-lg bg-surface p-4 text-base">
          <Row
            label={`Lapangan (${draft.startsAt.length} jam)`}
            value={formatIdr(price.courtIdr)}
          />
          {price.addOnsIdr > 0 && <Row label="Tambahan" value={formatIdr(price.addOnsIdr)} />}
          {price.discountIdr > 0 && (
            <Row
              label={`Potongan poin (${redeem.points})`}
              value={`− ${formatIdr(price.discountIdr)}`}
              tone="sage"
            />
          )}
          <Row label="Biaya layanan" value={formatIdr(price.serviceFeeIdr)} />
          <div className="h-px bg-divider" />
          <div className="flex items-baseline justify-between">
            <dt className="text-md font-bold">Total</dt>
            <dd className="font-heading text-2xl text-accent-700">{formatIdr(price.totalIdr)}</dd>
          </div>
          <p className="text-sm text-neutral-700">
            Kamu dapat {pointsEarned(price.subtotalIdr - price.discountIdr).toLocaleString('id-ID')}{' '}
            poin setelah main.
          </p>
        </dl>
      </section>
    </Screen>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'sage' }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-neutral-700">{label}</dt>
      <dd className={tone === 'sage' ? 'font-semibold text-accent2-700' : 'font-semibold'}>
        {value}
      </dd>
    </div>
  )
}

function defaultParticipants(hostName: string | undefined): SplitParticipant[] {
  return [{ id: 'sp-host', name: hostName ?? 'Kamu', isHost: true }]
}
