import { Link } from 'react-router-dom'
import { Building2, ChevronRight, Clock, LayoutGrid, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAdminCourts, useBookings, useClubSettings } from '@/hooks/queries'
import { formatIdr } from '@/lib/money'
import { Screen, ScreenHeader } from '@/components/layout/Screen'
import { Icon } from '@/components/ui/Icon'
import { Chip } from '@/components/ui/primitives'
import { ErrorState, SkeletonBlock } from '@/components/ui/states'

const SECTIONS: { to: string; label: string; body: string; icon: LucideIcon }[] = [
  {
    to: '/admin/lapangan',
    label: 'Lapangan',
    body: 'Tambah, ubah, atau hapus lapangan klub.',
    icon: LayoutGrid,
  },
  {
    to: '/admin/tarif',
    label: 'Tarif & iuran',
    body: 'Tarif dasar, prime time, biaya layanan, iuran anggota.',
    icon: Wallet,
  },
  {
    to: '/admin/klub',
    label: 'Profil & jam buka',
    body: 'Nama, alamat, area, dan jam operasional.',
    icon: Building2,
  },
]

/** Dasbor admin klub — pintu masuk ke seluruh pengaturan. */
export function AdminScreen() {
  const settings = useClubSettings()
  const courts = useAdminCourts()
  const bookings = useBookings()

  const upcoming = (bookings.data ?? []).filter(
    (b) => new Date(b.range.endsAt).getTime() > Date.now() && b.status === 'confirmed',
  )
  const belumDiisi = settings.data?.address.trim().toLowerCase() === 'alamat belum diisi'

  return (
    <Screen>
      <ScreenHeader title="Dasbor klub" />

      {settings.isLoading ? (
        <SkeletonBlock className="h-24 w-full rounded-lg" />
      ) : settings.error ? (
        <ErrorState body={settings.error.message} onRetry={() => void settings.refetch()} />
      ) : (
        settings.data && (
          <section className="flex flex-col gap-2 rounded-lg bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="flex-1 text-2xl">{settings.data.name}</h2>
              <Chip tone={belumDiisi ? 'accent' : 'sage'}>
                {belumDiisi ? 'Belum lengkap' : 'Aktif'}
              </Chip>
            </div>
            <p className="text-base text-neutral-700">
              {settings.data.address} · {settings.data.district}
            </p>
            <div className="flex items-center gap-2 text-base text-neutral-700">
              <Icon icon={Clock} size={15} />
              {String(settings.data.openHours.open).padStart(2, '0')}.00 –{' '}
              {String(settings.data.openHours.close).padStart(2, '0')}.00
            </div>
          </section>
        )
      )}

      {belumDiisi && (
        <div role="alert" className="flex flex-col gap-2 rounded-lg bg-accent-100 p-4">
          <h3 className="text-xl text-accent-900">Data klub belum diisi</h3>
          <p className="text-base text-accent-800">
            Nama lapangan, tarif, dan alamat masih memakai nilai awal. Isi lewat tiga bagian di
            bawah supaya yang tampil di app benar-benar data DBTC.
          </p>
        </div>
      )}

      <dl className="flex gap-3">
        <Stat label="Lapangan" value={courts.data ? String(courts.data.length) : '—'} />
        <Stat label="Booking aktif" value={String(upcoming.length)} />
        <Stat
          label="Tarif dasar"
          value={settings.data ? formatIdr(settings.data.basePricePerHourIdr) : '—'}
        />
      </dl>

      <nav className="flex flex-col gap-2.5" aria-label="Bagian pengaturan">
        {SECTIONS.map(({ to, label, body, icon }) => (
          <Link
            key={to}
            to={to}
            className="flex min-h-touch items-center gap-3.5 rounded-lg bg-surface px-4 py-3.5"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-accent2-200 text-accent2-800">
              <Icon icon={icon} size={19} />
            </span>
            <span className="flex flex-1 flex-col">
              <span className="text-md font-bold">{label}</span>
              <span className="text-sm text-neutral-700">{body}</span>
            </span>
            <Icon icon={ChevronRight} size={17} className="text-neutral-600" />
          </Link>
        ))}
      </nav>

      <p className="text-sm text-neutral-600">
        Perubahan di sini langsung dipakai layar booking — jam buka menentukan grid slot, dan tarif
        menentukan harga tiap jam.
      </p>
    </Screen>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-1 flex-col gap-0.5 rounded-md bg-surface px-3.5 py-3">
      <dt className="text-sm text-neutral-600">{label}</dt>
      <dd className="font-heading text-xl">{value}</dd>
    </div>
  )
}
