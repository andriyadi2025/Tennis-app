import { MessageSquarePlus } from 'lucide-react'
import { useComplaints } from '@/hooks/queries'
import { Screen, ScreenHeader, StickyBar } from '@/components/layout/Screen'
import { LinkButton } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { AsyncList, EmptyState, RowSkeleton } from '@/components/ui/states'
import { ComplaintRow } from '@/components/domain/ComplaintRow'

/** Bantuan — daftar aduan dan pesan yang pernah dikirim ke admin klub. */
export function HelpScreen() {
  const complaints = useComplaints()

  return (
    <Screen
      bottom={
        <StickyBar>
          <LinkButton to="/bantuan/baru" size="lg" block>
            <Icon icon={MessageSquarePlus} size={19} />
            Tulis pesan baru
          </LinkButton>
        </StickyBar>
      }
    >
      <ScreenHeader title="Bantuan" />

      <p className="-mt-2 text-base text-neutral-700">
        Kirim keluhan, pertanyaan, atau masukan ke pengurus klub. Balasannya masuk ke utas yang
        sama, jadi tidak ada percakapan yang tercecer.
      </p>

      <AsyncList
        isLoading={complaints.isLoading}
        error={complaints.error}
        data={complaints.data}
        onRetry={() => void complaints.refetch()}
        skeleton={<RowSkeleton count={3} />}
        empty={
          <EmptyState
            title="Belum ada pesan"
            body="Ada lampu mati, lapangan licin, atau pembayaran yang janggal? Ceritakan di sini."
          />
        }
      >
        {(rows) => (
          <ul className="flex flex-col gap-2.5">
            {rows.map((complaint) => (
              <li key={complaint.id}>
                <ComplaintRow complaint={complaint} />
              </li>
            ))}
          </ul>
        )}
      </AsyncList>
    </Screen>
  )
}
