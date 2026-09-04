import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import type { Sport, TeamDraft } from '@/types'
import { SPORTS, SPORT_LABEL } from '@/types'
import { useCreateTeam, useTeam, useUpdateTeam } from '@/hooks/queries'
import { usePreferencesStore } from '@/store/preferences'
import { Screen, ScreenHeader, StickyBar } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/primitives'
import { ErrorState, SkeletonBlock } from '@/components/ui/states'

const FORM_ID = 'form-tim'

/**
 * Membuat atau mengubah tim.
 *
 * Satu layar untuk keduanya: bidangnya sama persis, dan memisahkannya hanya
 * menghasilkan dua form yang harus diubah berbarengan setiap kali ada bidang
 * baru — yang berarti cepat atau lambat salah satunya tertinggal.
 */
export function TeamNewScreen() {
  const { id } = useParams<{ id: string }>()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const area = usePreferencesStore((s) => s.area)

  const existing = useTeam(id)
  const create = useCreateTeam()
  const update = useUpdateTeam(id)
  const save = editing ? update : create

  const [draft, setDraft] = useState<TeamDraft | null>(null)
  const form: TeamDraft =
    draft ??
    (existing.data
      ? {
          name: existing.data.name,
          sport: existing.data.sport,
          city: existing.data.city,
          about: existing.data.about,
        }
      : { name: '', sport: 'tennis', city: area.replace(/^Bandung.*/, 'Bandung'), about: '' })

  const set = <K extends keyof TeamDraft>(key: K, value: TeamDraft[K]) =>
    setDraft({ ...form, [key]: value })

  if (editing && existing.isLoading) {
    return (
      <Screen>
        <ScreenHeader title="Ubah tim" />
        <SkeletonBlock className="h-64 w-full rounded-lg" />
      </Screen>
    )
  }

  if (editing && (existing.error || !existing.data)) {
    return (
      <Screen>
        <ScreenHeader title="Ubah tim" />
        <ErrorState body={existing.error?.message ?? 'Tim tidak ditemukan.'} />
      </Screen>
    )
  }

  return (
    <Screen
      bottom={
        <StickyBar>
          <Button type="submit" form={FORM_ID} size="lg" block disabled={save.isPending}>
            {save.isPending ? 'Menyimpan…' : editing ? 'Simpan perubahan' : 'Buat tim'}
          </Button>
        </StickyBar>
      }
    >
      <ScreenHeader title={editing ? 'Ubah tim' : 'Tim baru'} />

      {!editing && (
        <p className="-mt-2 text-base text-neutral-700">
          Kamu otomatis jadi anggota pertamanya. Tim inilah yang jadi pengirim saat kamu mengajak
          tim lain sparring.
        </p>
      )}

      {/* noValidate: batasnya divalidasi di server, yang pesannya bisa
          ditampilkan — bukan diblokir diam-diam oleh peramban. */}
      <form
        id={FORM_ID}
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate(form, {
            onSuccess: (team) => navigate(`/team/${team.id}`, { replace: true }),
          })
        }}
      >
        <TextField
          label="Nama tim"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Mis. Dukuh Bima Muda"
          maxLength={60}
        />

        <section className="flex flex-col gap-2.5">
          <h2 className="text-xl">Cabang olahraga</h2>
          <div className="flex flex-wrap gap-2">
            {SPORTS.map((sport: Sport) => (
              <button
                key={sport}
                type="button"
                aria-pressed={form.sport === sport}
                onClick={() => set('sport', sport)}
                className={clsx(
                  'min-h-touch rounded-pill px-4 text-base font-semibold transition-colors',
                  form.sport === sport
                    ? 'bg-accent2-600 text-accent2-100'
                    : 'border border-divider text-text hover:bg-neutral-200',
                )}
              >
                {SPORT_LABEL[sport]}
              </button>
            ))}
          </div>
        </section>

        <TextField
          label="Kota"
          value={form.city}
          onChange={(e) => set('city', e.target.value)}
          placeholder="Bandung"
          maxLength={60}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="tim-about" className="text-sm text-neutral-700">
            Tentang tim
          </label>
          <textarea
            id="tim-about"
            rows={4}
            maxLength={400}
            value={form.about}
            onChange={(e) => set('about', e.target.value)}
            placeholder="Jadwal latihan, level pemain, atau apa yang dicari dari lawan."
            className="rounded-lg bg-surface px-4 py-3.5 text-lg text-text placeholder:text-neutral-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <span className="px-2 text-right text-sm text-neutral-600 tabular-nums">
            {form.about.length}/400
          </span>
        </div>

        {save.error && (
          <p role="alert" className="text-base text-accent-700">
            {save.error.message}
          </p>
        )}
      </form>
    </Screen>
  )
}
