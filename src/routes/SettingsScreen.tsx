import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import type { NotificationKind } from '@/types'
import { AREAS } from '@/types'
import { usePreferencesStore } from '@/store/preferences'
import { useAuthStore } from '@/store/auth'
import { useDraftStore } from '@/store/draft'
import { useToast } from '@/hooks/useToast'
import { resetDb } from '@/mocks/db'
import { Screen, ScreenHeader } from '@/components/layout/Screen'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Toast } from '@/components/ui/Toast'
import { Toggle, ToggleChip } from '@/components/ui/primitives'
import { PushSetting } from '@/components/domain/PushSetting'

const NOTIFY_LABEL: Record<NotificationKind, { title: string; body: string }> = {
  booking: { title: 'Booking', body: 'Pengingat main dan perubahan jadwal.' },
  payment: { title: 'Pembayaran', body: 'Konfirmasi bayar dan batas waktu hold.' },
  match: { title: 'Open match & sparring', body: 'Ada yang gabung atau mengajak main.' },
  community: { title: 'Komunitas', body: 'Split bill, obrolan grup, kabar tim.' },
  promo: { title: 'Promo & poin', body: 'Penawaran dan perubahan poin loyalitas.' },
}

const RADIUS_STEPS = [2, 5, 10, 20]

/** Pengaturan — preferensi tersimpan lokal, plus tombol reset data contoh. */
export function SettingsScreen() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const prefs = usePreferencesStore()
  const signOut = useAuthStore((s) => s.signOut)
  const resetDraft = useDraftStore((s) => s.reset)
  const { toast, show } = useToast()
  const [confirmingReset, setConfirmingReset] = useState(false)

  function resetDemoData() {
    resetDb()
    resetDraft()
    // Cache query masih memegang data lama, jadi harus ikut dibuang.
    void client.invalidateQueries()
    setConfirmingReset(false)
    show('Data contoh dikembalikan ke awal.')
  }

  return (
    <Screen overlay={<Toast toast={toast} />}>
      <ScreenHeader title="Pengaturan" />

      <section className="flex flex-col gap-3">
        <h2 className="text-3xl">Lokasi</h2>
        <div className="flex flex-col gap-2.5 rounded-lg bg-surface p-4">
          <span className="text-base text-neutral-700">Area yang dipakai Home dan pencarian</span>
          <div className="flex flex-wrap gap-2">
            {AREAS.map((area) => (
              <ToggleChip
                key={area}
                active={prefs.area === area}
                onClick={() => prefs.setArea(area)}
              >
                {area}
              </ToggleChip>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2.5 rounded-lg bg-surface p-4">
          <span className="text-base text-neutral-700">Radius bawaan pencarian</span>
          <div className="flex flex-wrap gap-2">
            {RADIUS_STEPS.map((km) => (
              <ToggleChip
                key={km}
                active={prefs.defaultRadiusKm === km}
                onClick={() => prefs.setRadius(km)}
              >
                {km} km
              </ToggleChip>
            ))}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-3xl">Notifikasi</h2>
        <p className="text-base text-neutral-700">
          Jenis yang dimatikan tidak lagi muncul di daftar notifikasi.
        </p>

        <PushSetting />
        <div className="flex flex-col gap-2">
          {(Object.keys(NOTIFY_LABEL) as NotificationKind[]).map((kind) => (
            <Toggle
              key={kind}
              checked={prefs.notify[kind]}
              onChange={() => prefs.toggleNotify(kind)}
              label={NOTIFY_LABEL[kind].title}
              description={NOTIFY_LABEL[kind].body}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-3xl">Tampilan</h2>
        <Toggle
          checked={prefs.reduceMotion}
          onChange={prefs.setReduceMotion}
          label="Kurangi animasi"
          description="Mematikan kilau skeleton dan transisi panjang."
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-3xl">Data contoh</h2>
        <p className="text-base text-neutral-700">
          App ini berjalan di atas backend tiruan. Booking, ajakan, dan ulasan yang kamu buat
          tersimpan di peramban ini saja.
        </p>

        {confirmingReset ? (
          <div role="alert" className="flex flex-col gap-3 rounded-lg bg-accent-100 p-4">
            <p className="text-base text-accent-900">
              Semua booking, ulasan, dan ajakan yang kamu buat akan hilang. Lanjut?
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" block onClick={() => setConfirmingReset(false)}>
                Batal
              </Button>
              <Button block onClick={resetDemoData}>
                Ya, reset
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" block onClick={() => setConfirmingReset(true)}>
            <Icon icon={RotateCcw} size={16} />
            Reset data contoh
          </Button>
        )}
      </section>

      <div className="flex flex-col gap-2">
        <Button
          variant="secondary"
          block
          onClick={() => {
            prefs.resetPreferences()
            show('Preferensi dikembalikan ke bawaan.')
          }}
        >
          Kembalikan preferensi bawaan
        </Button>
        <Button
          variant="ghost"
          block
          onClick={() => {
            signOut()
            navigate('/login', { replace: true })
          }}
        >
          Keluar dari akun
        </Button>
      </div>
    </Screen>
  )
}
