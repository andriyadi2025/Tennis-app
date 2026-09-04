import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { ActivityKind } from '@/types'
import { ACTIVITY_LABEL } from '@/types'
import { useClubSettings, useSaveClubSettings } from '@/hooks/queries'
import { useToast } from '@/hooks/useToast'
import { formatIdr } from '@/lib/money'
import { Screen, ScreenHeader, StickyBar } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { Toast } from '@/components/ui/Toast'
import { NumberField } from '@/components/ui/NumberField'
import { ErrorState, SkeletonBlock } from '@/components/ui/states'

const FORM_ID = 'form-tarif'

/** Admin · Tarif & iuran. */
export function AdminPricingScreen() {
  const settings = useClubSettings()
  const save = useSaveClubSettings()
  const { toast, show } = useToast()

  const [base, setBase] = useState('')
  const [fee, setFee] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [multiplier, setMultiplier] = useState('')
  const [dues, setDues] = useState('')
  const [activity, setActivity] = useState<Record<string, string>>({})
  const [discount, setDiscount] = useState('')

  // Form diisi dari server sekali data tiba, bukan ditebak dari nilai kosong.
  useEffect(() => {
    const s = settings.data
    if (!s) return
    setBase(String(s.basePricePerHourIdr))
    setFee(String(s.serviceFeeIdr))
    setFrom(String(s.primeTime.from))
    setTo(String(s.primeTime.to))
    setMultiplier(String(Math.round(s.primeTime.multiplier * 100)))
    setDues(String(s.membership.duesMonthlyIdr))
    setDiscount(String(Math.round(s.membership.memberDiscount * 100)))
    setActivity(
      Object.fromEntries(Object.entries(s.activityPoints).map(([k, v]) => [k, String(v)])),
    )
  }, [settings.data])

  if (settings.isLoading) {
    return (
      <Screen>
        <ScreenHeader title="Tarif & iuran" />
        <SkeletonBlock className="h-64 w-full rounded-lg" />
      </Screen>
    )
  }

  if (settings.error || !settings.data) {
    return (
      <Screen>
        <ScreenHeader title="Tarif & iuran" />
        <ErrorState
          body={settings.error?.message ?? 'Pengaturan tidak tersedia.'}
          onRetry={() => void settings.refetch()}
        />
      </Screen>
    )
  }

  const baseNum = Number(base) || 0
  const multiplierNum = (Number(multiplier) || 100) / 100
  const discountNum = (Number(discount) || 0) / 100
  const primePrice = Math.round((baseNum * multiplierNum) / 1_000) * 1_000
  const memberPrice = Math.round(baseNum * (1 - discountNum))

  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate(
      {
        basePricePerHourIdr: Number(base),
        serviceFeeIdr: Number(fee),
        primeTime: {
          from: Number(from),
          to: Number(to),
          multiplier: Number(multiplier) / 100,
        },
        membership: {
          duesMonthlyIdr: Number(dues),
          memberDiscount: Number(discount) / 100,
        },
        activityPoints: {
          bermain: Number(activity.bermain ?? 0),
          berlatih: Number(activity.berlatih ?? 0),
          mainBersama: Number(activity.mainBersama ?? 0),
          lomba: Number(activity.lomba ?? 0),
        },
      },
      { onSuccess: () => show('Tarif disimpan.') },
    )
  }

  return (
    <Screen
      overlay={<Toast toast={toast} />}
      bottom={
        <StickyBar>
          {/* Tombol di luar <form>, disambungkan lewat atribut form —
              cara HTML-nya, bukan memalsukan event submit. */}
          <Button type="submit" form={FORM_ID} size="lg" block disabled={save.isPending}>
            {save.isPending ? 'Menyimpan…' : 'Simpan tarif'}
          </Button>
        </StickyBar>
      }
    >
      <ScreenHeader title="Tarif & iuran" />

      <form id={FORM_ID} noValidate onSubmit={submit} className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h2 className="text-3xl">Sewa lapangan</h2>
          <NumberField
            label="Tarif dasar per jam"
            prefix="Rp"
            min={1000}
            value={base}
            onChange={setBase}
            hint="Dipakai lapangan yang tidak punya tarif sendiri."
          />
          <NumberField
            label="Biaya layanan per booking"
            prefix="Rp"
            min={0}
            value={fee}
            onChange={setFee}
          />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-3xl">Prime time</h2>
          <p className="text-base text-neutral-700">
            Jam sibuk yang tarifnya lebih tinggi. Boleh melewati tengah malam, mis. 20 sampai 1.
          </p>
          <div className="flex gap-3">
            <div className="flex-1">
              <NumberField label="Dari jam" min={0} max={23} value={from} onChange={setFrom} />
            </div>
            <div className="flex-1">
              <NumberField label="Sampai jam" min={0} max={23} value={to} onChange={setTo} />
            </div>
          </div>
          <NumberField
            label="Kenaikan tarif"
            suffix="%"
            min={100}
            max={300}
            value={multiplier}
            onChange={setMultiplier}
            hint="100% berarti tidak ada kenaikan."
          />
          <p className="rounded-md bg-surface px-4 py-3 text-base">
            Jam {from || '—'}.00–{to || '—'}.00 jadi{' '}
            <strong className="font-heading text-accent-700">{formatIdr(primePrice)}</strong>/jam,
            di luar itu {formatIdr(baseNum)}/jam.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-3xl">Keanggotaan</h2>
          <NumberField
            label="Iuran per bulan"
            prefix="Rp"
            min={0}
            value={dues}
            onChange={setDues}
          />
          <NumberField
            label="Potongan sewa untuk anggota"
            suffix="%"
            min={0}
            max={90}
            value={discount}
            onChange={setDiscount}
          />
          <p className="rounded-md bg-surface px-4 py-3 text-base">
            Anggota bayar{' '}
            <strong className="font-heading text-accent-700">{formatIdr(memberPrice)}</strong>/jam
            di jam biasa.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-3xl">Poin partisipasi</h2>
          <p className="text-base text-neutral-700">
            Poin yang didapat anggota tiap kali sebuah kegiatan selesai. Terpisah dari poin belanja,
            yang tetap 1 poin per Rp1.000.
          </p>
          {(Object.keys(ACTIVITY_LABEL) as ActivityKind[]).map((kind) => (
            <NumberField
              key={kind}
              label={ACTIVITY_LABEL[kind]}
              suffix="poin"
              min={0}
              max={1000}
              value={activity[kind] ?? ''}
              onChange={(next) => setActivity((current) => ({ ...current, [kind]: next }))}
            />
          ))}
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
