import { useState } from 'react'
import clsx from 'clsx'
import type { ComplaintStatus } from '@/types'
import { COMPLAINT_STATUS_LABEL } from '@/types'
import { useComplaints } from '@/hooks/queries'
import { awaitingAdmin, countAwaitingAdmin } from '@/lib/complaints'
import { Screen, ScreenHeader } from '@/components/layout/Screen'
import { AsyncList, EmptyState, RowSkeleton } from '@/components/ui/states'
import { ComplaintRow } from '@/components/domain/ComplaintRow'

const TABS: { value: ComplaintStatus | 'menunggu' | 'semua'; label: string }[] = [
  { value: 'menunggu', label: 'Perlu dijawab' },
  { value: 'semua', label: 'Semua' },
  { value: 'baru', label: COMPLAINT_STATUS_LABEL.baru },
  { value: 'diproses', label: COMPLAINT_STATUS_LABEL.diproses },
  { value: 'selesai', label: COMPLAINT_STATUS_LABEL.selesai },
]

/**
 * Aduan masuk. Tab bawaannya "Perlu dijawab", bukan "Semua": yang dicari
 * pengurus saat membuka layar ini adalah pekerjaan yang belum dikerjakan.
 */
export function AdminComplaintsScreen() {
  const [tab, setTab] = useState<ComplaintStatus | 'menunggu' | 'semua'>('menunggu')
  const complaints = useComplaints()

  const rows = (complaints.data ?? []).filter((c) => {
    if (tab === 'semua') return true
    if (tab === 'menunggu') return awaitingAdmin(c)
    return c.status === tab
  })
  const menunggu = countAwaitingAdmin(complaints.data ?? [])

  return (
    <Screen>
      <ScreenHeader title="Aduan masuk" />

      <p className="-mt-2 text-base text-neutral-700">
        {menunggu === 0
          ? 'Tidak ada aduan yang menunggu jawaban klub.'
          : `${menunggu} aduan menunggu jawaban klub.`}
      </p>

      <div className="row-scroll -mx-5 flex gap-2 px-5" role="tablist" aria-label="Saring aduan">
        {TABS.map(({ value, label }) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={clsx(
              'min-h-touch shrink-0 rounded-pill px-4 text-base font-semibold transition-colors',
              tab === value
                ? 'bg-accent2-600 text-accent2-100'
                : 'border border-divider text-text hover:bg-neutral-200',
            )}
          >
            {label}
            {value === 'menunggu' && menunggu > 0 && (
              <span className="ml-1.5 tabular-nums">({menunggu})</span>
            )}
          </button>
        ))}
      </div>

      <AsyncList
        isLoading={complaints.isLoading}
        error={complaints.error}
        data={rows}
        onRetry={() => void complaints.refetch()}
        skeleton={<RowSkeleton count={3} />}
        empty={
          <EmptyState
            title="Tidak ada aduan di sini"
            body={
              tab === 'menunggu'
                ? 'Semua aduan sudah dijawab. Cek tab lain untuk melihat riwayatnya.'
                : 'Belum ada aduan dengan status ini.'
            }
          />
        }
      >
        {(list) => (
          <ul className="flex flex-col gap-2.5">
            {list.map((complaint) => (
              <li key={complaint.id}>
                <ComplaintRow complaint={complaint} showAuthor />
              </li>
            ))}
          </ul>
        )}
      </AsyncList>
    </Screen>
  )
}
