import { Link } from 'react-router-dom'
import { Bell, CalendarDays, Swords, Users, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AppNotification, NotificationKind } from '@/types'
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from '@/hooks/queries'
import { formatRelative } from '@/lib/dates'
import { Screen, ScreenHeader } from '@/components/layout/Screen'
import { Icon } from '@/components/ui/Icon'
import { AsyncList, EmptyState, RowSkeleton } from '@/components/ui/states'

const KIND_ICON: Record<NotificationKind, LucideIcon> = {
  booking: CalendarDays,
  payment: Wallet,
  match: Swords,
  promo: Bell,
  community: Users,
}

const KIND_TONE: Record<NotificationKind, string> = {
  booking: 'bg-accent2-200 text-accent2-800',
  payment: 'bg-accent-200 text-accent-800',
  match: 'bg-accent2-200 text-accent2-800',
  promo: 'bg-accent-200 text-accent-800',
  community: 'bg-neutral-300 text-neutral-800',
}

/** Kelompok waktu: hari ini, kemarin, minggu ini, lebih lama. */
function bucketOf(iso: string, now: Date): string {
  const then = new Date(iso)
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const diffDays = Math.floor((startOfToday.getTime() - then.getTime()) / 86_400_000)
  if (then.getTime() >= startOfToday.getTime()) return 'Hari ini'
  if (diffDays < 1) return 'Kemarin'
  if (diffDays < 7) return 'Minggu ini'
  return 'Lebih lama'
}

const BUCKET_ORDER = ['Hari ini', 'Kemarin', 'Minggu ini', 'Lebih lama']

function groupByTime(rows: AppNotification[]): [string, AppNotification[]][] {
  const now = new Date()
  const groups = new Map<string, AppNotification[]>()
  rows.forEach((row) => {
    const bucket = bucketOf(row.createdAt, now)
    const list = groups.get(bucket)
    if (list) list.push(row)
    else groups.set(bucket, [row])
  })
  return BUCKET_ORDER.filter((b) => groups.has(b)).map((b) => [b, groups.get(b) ?? []])
}

/** 12 · Notifikasi, dikelompokkan per waktu. */
export function NotificationsScreen() {
  const notifications = useNotifications()
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()

  const unread = (notifications.data ?? []).filter((n) => !n.read).length

  return (
    <Screen>
      <ScreenHeader
        title="Notifikasi"
        action={
          unread > 0 ? (
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="min-h-touch px-2 text-base font-semibold text-accent-700 disabled:opacity-45"
            >
              Tandai semua
            </button>
          ) : undefined
        }
      />

      <AsyncList
        isLoading={notifications.isLoading}
        error={notifications.error}
        data={notifications.data}
        onRetry={() => void notifications.refetch()}
        skeleton={<RowSkeleton count={5} />}
        empty={
          <EmptyState
            title="Belum ada notifikasi"
            body="Kabar booking, open match, dan split bill akan muncul di sini."
          />
        }
      >
        {(rows) => (
          <div className="flex flex-col gap-6">
            {groupByTime(rows).map(([bucket, items]) => (
              <section key={bucket} className="flex flex-col gap-2.5">
                <h2 className="text-xl text-neutral-700">{bucket}</h2>
                <ul className="flex flex-col gap-2">
                  {items.map((item) => (
                    <li key={item.id}>
                      <NotificationRow
                        notification={item}
                        onOpen={() => {
                          if (!item.read) markRead.mutate(item.id)
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </AsyncList>
    </Screen>
  )
}

function NotificationRow({
  notification,
  onOpen,
}: {
  notification: AppNotification
  onOpen: () => void
}) {
  const content = (
    <div className="flex items-start gap-3.5 rounded-lg bg-surface p-4">
      <span
        aria-hidden
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-pill ${KIND_TONE[notification.kind]}`}
      >
        <Icon icon={KIND_ICON[notification.kind]} size={19} />
      </span>
      <div className="flex flex-1 flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <span className="flex-1 text-base font-bold">{notification.title}</span>
          {!notification.read && (
            <span
              aria-label="Belum dibaca"
              className="h-2.5 w-2.5 shrink-0 rounded-pill bg-accent"
            />
          )}
        </div>
        <p className="text-base text-neutral-700">{notification.body}</p>
        <span className="text-sm text-neutral-600">{formatRelative(notification.createdAt)}</span>
      </div>
    </div>
  )

  // Tanpa tujuan, barisnya tetap bisa diketuk hanya untuk menandai dibaca.
  if (!notification.href) {
    return (
      <button type="button" onClick={onOpen} className="w-full text-left">
        {content}
      </button>
    )
  }
  return (
    <Link to={notification.href} onClick={onOpen}>
      {content}
    </Link>
  )
}
