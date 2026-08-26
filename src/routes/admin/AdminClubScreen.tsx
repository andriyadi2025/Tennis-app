import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { AREAS } from '@/types'
import { useClubSettings, useSaveClubSettings } from '@/hooks/queries'
import { useToast } from '@/hooks/useToast'
import { Screen, ScreenHeader, StickyBar } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { Toast } from '@/components/ui/Toast'
import { NumberField } from '@/components/ui/NumberField'
import { TextField, ToggleChip } from '@/components/ui/primitives'
import { ErrorState, SkeletonBlock } from '@/components/ui/states'

const FORM_ID = 'form-klub'

/** Admin · Profil klub & jam buka. */
export function AdminClubScreen() {
  const settings = useClubSettings()
  const save = useSaveClubSettings()
  const { toast, show } = useToast()

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [district, setDistrict] = useState('')
  const [open, setOpen] = useState('')
  const [close, setClose] = useState('')

  useEffect(() => {
    const s = settings.data
    if (!s) return
    setName(s.name)
    setAddress(s.address)
    setDistrict(s.district)
    setOpen(String(s.openHours.open))
    setClose(String(s.openHours.close))
  }, [settings.data])

  if (settings.isLoading) {
    return (
      <Screen>
        <ScreenHeader title="Profil klub" />
        <SkeletonBlock className="h-64 w-full rounded-lg" />
      </Screen>
    )
  }

  if (settings.error || !settings.data) {
    return (
      <Screen>
        <ScreenHeader title="Profil klub" />
        <ErrorState
          body={settings.error?.message ?? 'Pengaturan tidak tersedia.'}
          onRetry={() => void settings.refetch()}
        />
      </Screen>
    )
  }

  const openNum = Number(open)
  const closeNum = Number(close)
  const hours = closeNum > openNum ? closeNum - openNum : 0

  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate(
      {
        name,
        address,
        district,
        openHours: { open: Number(open), close: Number(close) },
      },
      { onSuccess: () => show('Profil klub disimpan.') },
    )
  }

  return (
    <Screen
      overlay={<Toast toast={toast} />}
      bottom={
        <StickyBar>
          <Button type="submit" form={FORM_ID} size="lg" block disabled={save.isPending}>
            {save.isPending ? 'Menyimpan…' : 'Simpan profil'}
          </Button>
        </StickyBar>
      }
    >
      <ScreenHeader title="Profil klub" />

      <form id={FORM_ID} noValidate onSubmit={submit} className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h2 className="text-3xl">Identitas</h2>
          <TextField
            label="Nama klub"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dukuh Bima Tennis Club"
          />
          <TextField
            label="Alamat"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Jl. ... No. ..., Kecamatan"
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm text-neutral-700">Area</legend>
            <div className="flex flex-wrap gap-2">
              {AREAS.map((area) => (
                <ToggleChip key={area} active={district === area} onClick={() => setDistrict(area)}>
                  {area}
                </ToggleChip>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-3xl">Jam operasional</h2>
          <p className="text-base text-neutral-700">
            Menentukan jam mana saja yang muncul di grid pilih jadwal.
          </p>
          <div className="flex gap-3">
            <div className="flex-1">
              <NumberField label="Buka jam" min={0} max={23} value={open} onChange={setOpen} />
            </div>
            <div className="flex-1">
              <NumberField label="Tutup jam" min={1} max={24} value={close} onChange={setClose} />
            </div>
          </div>
          <p className="rounded-md bg-surface px-4 py-3 text-base">
            {hours > 0
              ? `${hours} slot per hari, dari ${open}.00 sampai ${close}.00.`
              : 'Jam tutup harus lebih malam dari jam buka.'}
          </p>
        </section>

        {save.error && (
          <p role="alert" className="text-base text-accent-700">
            {save.error.message}
          </p>
        )}
      </form>
    </Screen>
  )
}
