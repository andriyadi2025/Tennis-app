import { useState } from 'react'
import type { FormEvent } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { Court, CourtDraft, Sport } from '@/types'
import { SPORTS, SPORT_LABEL } from '@/types'
import {
  useAddCourt,
  useAdminCourts,
  useClubSettings,
  useDeleteCourt,
  useUpdateCourt,
} from '@/hooks/queries'
import { useToast } from '@/hooks/useToast'
import { formatIdr } from '@/lib/money'
import { Screen, ScreenHeader } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Toast } from '@/components/ui/Toast'
import { NumberField } from '@/components/ui/NumberField'
import { Chip, TextField, Toggle, ToggleChip } from '@/components/ui/primitives'
import { AsyncList, EmptyState, RowSkeleton } from '@/components/ui/states'

const BLANK: CourtDraft = {
  name: '',
  sport: 'tennis',
  indoor: false,
  surface: '',
  pricePerHourIdr: null,
}

/** Admin · Lapangan — CRUD lapangan milik klub. */
export function AdminCourtsScreen() {
  const courts = useAdminCourts()
  const settings = useClubSettings()
  const { toast, show } = useToast()
  const [editing, setEditing] = useState<Court | 'baru' | null>(null)

  const base = settings.data?.basePricePerHourIdr ?? 0

  return (
    <Screen overlay={<Toast toast={toast} />}>
      <ScreenHeader title="Lapangan" />

      <p className="text-base text-neutral-700">
        Nama lapangan yang dilihat anggota saat memilih jam. Tarif kosong berarti ikut tarif dasar
        klub{base > 0 ? ` (${formatIdr(base)}/jam)` : ''}.
      </p>

      <AsyncList
        isLoading={courts.isLoading}
        error={courts.error}
        data={courts.data}
        onRetry={() => void courts.refetch()}
        skeleton={<RowSkeleton count={3} />}
        empty={
          <EmptyState
            title="Belum ada lapangan"
            body="Tambahkan lapangan pertama supaya anggota bisa mulai booking."
          />
        }
      >
        {(rows) => (
          <ul className="flex flex-col gap-2.5">
            {rows.map((court) => (
              <li
                key={court.id}
                className="flex items-center gap-3 rounded-lg bg-surface px-4 py-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-md font-bold">{court.name}</span>
                  <span className="truncate text-sm text-neutral-700">
                    {SPORT_LABEL[court.sport]} · {court.surface} ·{' '}
                    {court.indoor ? 'indoor' : 'outdoor'}
                  </span>
                  <Chip tone={court.pricePerHourIdr ? 'accent' : 'neutral'} className="self-start">
                    {court.pricePerHourIdr
                      ? `${formatIdr(court.pricePerHourIdr)}/jam`
                      : 'Ikut tarif dasar'}
                  </Chip>
                </div>
                <button
                  type="button"
                  aria-label={`Ubah ${court.name}`}
                  onClick={() => setEditing(court)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-bg"
                >
                  <Icon icon={Pencil} size={17} />
                </button>
                <DeleteCourtButton court={court} onDone={show} />
              </li>
            ))}
          </ul>
        )}
      </AsyncList>

      <Button variant="secondary" block onClick={() => setEditing('baru')}>
        <Icon icon={Plus} size={16} />
        Tambah lapangan
      </Button>

      {editing && (
        <CourtSheet
          court={editing === 'baru' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null)
            show(message)
          }}
        />
      )}
    </Screen>
  )
}

function DeleteCourtButton({
  court,
  onDone,
}: {
  court: Court
  onDone: (message: string, tone?: 'sukses' | 'gagal') => void
}) {
  const remove = useDeleteCourt()
  const [confirming, setConfirming] = useState(false)

  if (confirming) {
    return (
      <span className="flex shrink-0 gap-1.5">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="min-h-touch rounded-pill bg-bg px-3 text-sm font-semibold"
        >
          Batal
        </button>
        <button
          type="button"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(court.id, {
              onSuccess: () => onDone(`${court.name} dihapus.`),
              onError: (error) => {
                setConfirming(false)
                onDone(error.message, 'gagal')
              },
            })
          }
          className="min-h-touch rounded-pill bg-accent-700 px-3 text-sm font-semibold text-bg"
        >
          Hapus
        </button>
      </span>
    )
  }

  return (
    <button
      type="button"
      aria-label={`Hapus ${court.name}`}
      onClick={() => setConfirming(true)}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-bg text-accent-700"
    >
      <Icon icon={Trash2} size={17} />
    </button>
  )
}

function CourtSheet({
  court,
  onClose,
  onSaved,
}: {
  /** `null` berarti membuat lapangan baru. */
  court: Court | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [draft, setDraft] = useState<CourtDraft>(
    court
      ? {
          name: court.name,
          sport: court.sport,
          indoor: court.indoor,
          surface: court.surface,
          pricePerHourIdr: court.pricePerHourIdr ?? null,
        }
      : BLANK,
  )
  const [priceText, setPriceText] = useState(
    court?.pricePerHourIdr ? String(court.pricePerHourIdr) : '',
  )
  const add = useAddCourt()
  const update = useUpdateCourt()
  const pending = add.isPending || update.isPending
  const error = add.error ?? update.error

  function submit(event: FormEvent) {
    event.preventDefault()
    const payload: CourtDraft = {
      ...draft,
      pricePerHourIdr: priceText.trim() === '' ? null : Number(priceText),
    }
    const done = () => onSaved(court ? `${payload.name} disimpan.` : `${payload.name} ditambahkan.`)
    if (court) update.mutate({ id: court.id, draft: payload }, { onSuccess: done })
    else add.mutate(payload, { onSuccess: done })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={court ? `Ubah ${court.name}` : 'Tambah lapangan'}
      className="sheet-backdrop absolute inset-0 z-20 flex flex-col justify-end"
    >
      <button
        type="button"
        aria-label="Tutup"
        className="flex-1 cursor-default"
        onClick={onClose}
      />
      <form
        noValidate
        onSubmit={submit}
        className="scroll-area flex max-h-[88%] flex-col gap-4 rounded-t-lg bg-bg px-5 pb-5 pt-6"
      >
        <h2 className="text-3xl">{court ? 'Ubah lapangan' : 'Tambah lapangan'}</h2>

        <TextField
          label="Nama lapangan"
          placeholder="Lap. 1"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm text-neutral-700">Cabang olahraga</legend>
          <div className="flex flex-wrap gap-2">
            {SPORTS.map((sport) => (
              <ToggleChip
                key={sport}
                active={draft.sport === sport}
                onClick={() => setDraft({ ...draft, sport: sport as Sport })}
              >
                {SPORT_LABEL[sport]}
              </ToggleChip>
            ))}
          </div>
        </fieldset>

        <TextField
          label="Jenis permukaan"
          placeholder="Hard court"
          value={draft.surface}
          onChange={(e) => setDraft({ ...draft, surface: e.target.value })}
        />

        <Toggle
          checked={draft.indoor}
          onChange={(next) => setDraft({ ...draft, indoor: next })}
          label="Indoor"
          description="Matikan kalau lapangan ini terbuka."
        />

        <NumberField
          label="Tarif khusus lapangan ini"
          prefix="Rp"
          suffix="/jam"
          min={0}
          value={priceText}
          onChange={setPriceText}
          hint="Kosongkan untuk mengikuti tarif dasar klub."
        />

        {error && (
          <p role="alert" className="text-base text-accent-700">
            {error.message}
          </p>
        )}

        <div className="flex gap-3">
          <Button variant="secondary" block onClick={onClose} disabled={pending}>
            Batal
          </Button>
          <Button type="submit" block disabled={pending}>
            {pending ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </div>
      </form>
    </div>
  )
}
