import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Smartphone } from 'lucide-react'
import type { MergePreview, MergeResult } from '@/lib/authApi'
import { confirmMerge, requestMergeOtp } from '@/lib/authApi'
import { useAuthStore } from '@/store/auth'
import { Screen, ScreenHeader, StickyBar } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { OtpInput } from '@/components/ui/OtpInput'
import { TextField } from '@/components/ui/primitives'

const LABEL: Record<keyof MergePreview, string> = {
  bookings: 'Booking',
  merchOrders: 'Pesanan toko',
  complaints: 'Aduan',
  registrations: 'Pendaftaran turnamen',
  teams: 'Keanggotaan tim',
  points: 'Poin',
}

/**
 * Menggabungkan akun lain ke akun ini.
 *
 * Penggabungan **tidak bisa dibatalkan**, jadi layarnya dibuat bertahap dan
 * menunjukkan isi akun yang akan diserap sebelum kodenya diminta diketik.
 * Tombol yang langsung menelan satu akun tanpa memperlihatkan apa isinya
 * adalah tombol yang tidak seharusnya ditekan siapa pun.
 */
export function AccountMergeScreen() {
  const token = useAuthStore((s) => s.token)
  const setUser = useAuthStore((s) => s.setUser)
  const client = useQueryClient()
  const navigate = useNavigate()

  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [devCode, setDevCode] = useState<string | null>(null)
  const [done, setDone] = useState<MergeResult | null>(null)

  const request = useMutation({
    mutationFn: () => requestMergeOtp(token!, phone),
    onSuccess: (result) => {
      setSent(result.phone)
      setPreview(result.preview)
      setDevCode(result.devCode ?? null)
    },
  })

  const confirm = useMutation({
    mutationFn: () => confirmMerge(token!, sent!, code),
    onSuccess: (result) => {
      setUser(result.user)
      setDone(result)
      // Hampir semua data pindah pemilik, jadi tidak ada cache yang masih benar.
      void client.invalidateQueries()
    },
  })

  if (done) {
    const { merged } = done
    return (
      <Screen
        bottom={
          <StickyBar>
            <Button size="lg" block onClick={() => navigate('/profile', { replace: true })}>
              Selesai
            </Button>
          </StickyBar>
        }
      >
        <ScreenHeader title="Akun digabungkan" />

        <div className="flex flex-col gap-2 rounded-lg bg-accent2-200 p-4">
          <h2 className="text-xl text-accent2-900">Selesai</h2>
          <p className="text-base text-accent2-800">
            {merged.pointsAdded.toLocaleString('id-ID')} poin ditambahkan, dan seluruh riwayat akun
            lama sekarang ada di akun ini.
          </p>
        </div>

        {merged.contacts.released.length > 0 && (
          <div role="alert" className="flex flex-col gap-2 rounded-lg bg-accent-100 p-4">
            <h3 className="text-xl text-accent-900">Ada cara masuk yang dilepas</h3>
            <p className="text-base text-accent-800">
              {merged.contacts.released.includes('email') ? 'Email' : 'Nomor'} akun lama tidak bisa
              ikut pindah karena akun ini sudah punya. Kontak itu sekarang bebas dan bisa
              disambungkan lagi setelah yang lama dilepas.
            </p>
          </div>
        )}

        {Object.values(merged.skipped).some((n) => n > 0) && (
          <div className="flex flex-col gap-2 rounded-lg bg-surface p-4">
            <h3 className="text-md font-bold">Ada yang dibuang karena kembar</h3>
            <p className="text-base text-neutral-700">
              Kedua akun sudah punya barisnya — mendaftar dua kali di turnamen yang sama tidak
              menjadi dua kursi.
            </p>
          </div>
        )}
      </Screen>
    )
  }

  return (
    <Screen
      bottom={
        <StickyBar>
          {sent === null ? (
            <Button
              size="lg"
              block
              disabled={request.isPending || !phone.trim()}
              onClick={() => request.mutate()}
            >
              {request.isPending ? 'Memeriksa…' : 'Cek akun itu'}
            </Button>
          ) : (
            <Button
              size="lg"
              block
              disabled={code.length !== 6 || confirm.isPending}
              onClick={() => confirm.mutate()}
            >
              {confirm.isPending ? 'Menggabungkan…' : 'Gabungkan sekarang'}
            </Button>
          )}
        </StickyBar>
      }
    >
      <ScreenHeader title="Gabungkan akun" />

      <p className="-mt-2 text-base text-neutral-700">
        Punya dua akun karena pernah daftar lewat nomor dan lewat email? Gabungkan supaya booking,
        poin, dan riwayat mainnya jadi satu.
      </p>

      {sent === null ? (
        <>
          <TextField
            label="Nomor HP akun yang mau digabungkan"
            type="tel"
            inputMode="tel"
            placeholder="0812 8845 1190"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            leading={<Icon icon={Smartphone} size={18} className="text-neutral-600" />}
            error={request.error?.message}
          />
          <p className="text-sm text-neutral-600">
            Kami kirim kode ke nomor itu. Tanpa kode, tidak ada yang digabungkan — memastikan kedua
            akun memang milik orang yang sama tidak bisa dilewati.
          </p>
        </>
      ) : (
        <>
          {preview && (
            <section className="flex flex-col gap-2.5 rounded-lg bg-surface p-4">
              <h2 className="text-xl">Yang akan pindah ke akun ini</h2>
              <dl className="flex flex-col gap-1.5">
                {(Object.keys(LABEL) as (keyof MergePreview)[])
                  .filter((key) => preview[key] > 0)
                  .map((key) => (
                    <div key={key} className="flex items-baseline justify-between gap-4 text-base">
                      <dt className="text-neutral-700">{LABEL[key]}</dt>
                      <dd className="font-semibold tabular-nums">
                        {preview[key].toLocaleString('id-ID')}
                      </dd>
                    </div>
                  ))}
              </dl>
              {Object.values(preview).every((n) => n === 0) && (
                <p className="text-base text-neutral-700">
                  Akun itu masih kosong — tidak ada yang hilang maupun bertambah.
                </p>
              )}
              <p className="text-sm text-accent-700">
                Setelah digabungkan, akun lama dihapus dan ini tidak bisa dibatalkan.
              </p>
            </section>
          )}

          <div className="flex flex-col gap-3">
            <p className="text-base text-neutral-700">Kami kirim 6 angka ke {sent}.</p>
            {devCode && (
              <p className="rounded-md bg-accent2-200 px-3.5 py-2.5 text-sm text-accent2-900">
                Mode pengembangan — kodenya <strong>{devCode}</strong>. Di produksi ini dikirim
                lewat SMS dan tidak pernah tampil di sini.
              </p>
            )}
            <OtpInput value={code} onChange={setCode} disabled={confirm.isPending} />
            {confirm.error && (
              <p role="alert" className="text-base text-accent-700">
                {confirm.error.message}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setSent(null)
              setPreview(null)
              setCode('')
            }}
            className="min-h-touch text-base font-semibold text-accent-700 underline"
          >
            Salah nomor? Ganti
          </button>
        </>
      )}
    </Screen>
  )
}
