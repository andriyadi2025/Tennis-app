import { useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import type { PushStatus } from '@/lib/push'
import { pushStatus, sendTestPush, subscribePush, unsubscribePush } from '@/lib/push'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Chip } from '@/components/ui/primitives'

/**
 * Menyalakan notifikasi push di perangkat ini.
 *
 * Tiap keadaan dikatakan apa adanya, bukan disembunyikan di balik satu
 * tombol yang kadang bekerja: peramban yang tidak mendukung, server yang
 * belum dikonfigurasi, dan izin yang sudah ditolak permanen adalah tiga
 * masalah berbeda dengan tiga jalan keluar berbeda.
 *
 * Izin diminta saat tombolnya ditekan, bukan saat layar dibuka. Peramban
 * menghitung penolakan yang diminta tanpa konteks, dan sekali ditolak
 * permanen tidak ada cara memintanya lagi dari dalam app.
 */
export function PushSetting() {
  const [status, setStatus] = useState<PushStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    void pushStatus().then(setStatus)
  }, [])

  if (!status) return null

  async function run(action: () => Promise<PushStatus>) {
    setBusy(true)
    setNote(null)
    try {
      setStatus(await action())
    } finally {
      setBusy(false)
    }
  }

  const aktif = status.state === 'subscribed'

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface p-4">
      <div className="flex items-center gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-accent2-200 text-accent2-800">
          <Icon icon={BellRing} size={19} />
        </span>
        <div className="flex flex-1 flex-col">
          <span className="text-md font-bold">Push ke perangkat ini</span>
          <span className="text-sm text-neutral-700">
            Kabar booking, pesanan, dan aduan sampai walau app tertutup.
          </span>
        </div>
        {aktif && <Chip tone="sage">Aktif</Chip>}
      </div>

      {status.message && !aktif && <p className="text-base text-neutral-700">{status.message}</p>}

      {status.state === 'prompt' && (
        <Button block disabled={busy} onClick={() => void run(subscribePush)}>
          {busy ? 'Meminta izin…' : 'Nyalakan notifikasi'}
        </Button>
      )}

      {aktif && (
        <div className="flex gap-3">
          <Button
            variant="secondary"
            block
            disabled={busy}
            onClick={() => void run(unsubscribePush)}
          >
            Matikan
          </Button>
          <Button
            variant="secondary"
            block
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const result = await sendTestPush()
              setNote(
                result.delivered
                  ? 'Terkirim. Kalau tidak muncul, cek izin notifikasi di setelan sistem.'
                  : 'Server tidak berhasil mengirim ke perangkat ini.',
              )
              setBusy(false)
            }}
          >
            Kirim uji coba
          </Button>
        </div>
      )}

      {note && <p className="text-sm text-neutral-600">{note}</p>}

      {status.state === 'error' && (
        <p role="alert" className="text-base text-accent-700">
          {status.message}
        </p>
      )}
    </div>
  )
}
