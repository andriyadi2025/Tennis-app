import webpush from 'web-push'
import { config } from './config.ts'
import { db } from './db.ts'
import type { Sql } from './store/index.ts'

/**
 * Notifikasi push lewat Web Push.
 *
 * Sebelum ini push sengaja **tidak** dipalsukan: yang bisa dibuat tanpa
 * service worker dan kunci VAPID hanyalah tiruan yang menyesatkan. Sekarang
 * ia sungguhan — dan tetap jujur soal batasnya: tanpa `VAPID_*` terisi, push
 * dinyatakan tidak tersedia dan endpoint-nya menolak, bukan diam-diam gagal.
 *
 * Kunci VAPID **tidak** dibangkitkan otomatis saat start. Kunci publiknya
 * tersimpan di setiap langganan browser; membangkitkannya ulang tiap restart
 * akan membuat seluruh langganan yang ada jadi tidak bisa dipakai, tanpa satu
 * pun tanda bahwa itu yang terjadi.
 */

export function pushConfigured(): boolean {
  return Boolean(config.vapid.publicKey && config.vapid.privateKey && config.vapid.subject)
}

let ready = false

function ensureConfigured(): void {
  if (ready || !pushConfigured()) return
  webpush.setVapidDetails(config.vapid.subject!, config.vapid.publicKey!, config.vapid.privateKey!)
  ready = true
}

export interface PushSubscriptionInput {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export async function saveSubscription(
  userId: string,
  subscription: PushSubscriptionInput,
  userAgent: string | null,
  sql: Sql = db,
): Promise<void> {
  /*
   * Endpoint jadi kunci utamanya, bukan pasangan (user, endpoint): satu
   * peramban punya satu endpoint, dan kalau perangkatnya berpindah tangan
   * langganan itu harus mengikuti pemilik barunya — bukan mengirim notifikasi
   * orang sebelumnya ke sana.
   */
  await sql.run(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = excluded.user_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       user_agent = excluded.user_agent`,
    [
      subscription.endpoint,
      userId,
      subscription.keys.p256dh,
      subscription.keys.auth,
      userAgent,
      new Date().toISOString(),
    ],
  )
}

export async function removeSubscription(endpoint: string, sql: Sql = db): Promise<void> {
  await sql.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint])
}

export async function countSubscriptions(userId: string, sql: Sql = db): Promise<number> {
  const row = await sql.get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?',
    [userId],
  )
  return Number(row?.n ?? 0)
}

export interface PushPayload {
  title: string
  body: string
  /** Rute yang dibuka saat notifikasinya diketuk. */
  href?: string | null
  /**
   * Pengganti notifikasi lama dengan tag yang sama. Tanpa ini, sepuluh
   * perubahan pada satu booking jadi sepuluh notifikasi berturut-turut.
   */
  tag?: string
}

export interface PushResult {
  sent: number
  /** Langganan yang dibuang karena penerimanya sudah tidak ada. */
  pruned: number
  /** True hanya kalau push benar-benar dikirim ke layanan push peramban. */
  delivered: boolean
}

/**
 * Mengirim satu notifikasi ke semua perangkat seorang user.
 *
 * Langganan yang dijawab 404 atau 410 **dihapus**. Itu jawaban layanan push
 * untuk perangkat yang sudah mencabut izin atau kehilangan langganannya, dan
 * menyimpannya berarti mencoba mengirim ke sana selamanya.
 */
export async function sendPush(
  userId: string,
  payload: PushPayload,
  sql: Sql = db,
): Promise<PushResult> {
  if (!pushConfigured()) return { sent: 0, pruned: 0, delivered: false }
  ensureConfigured()

  const rows = await sql.all<{ endpoint: string; p256dh: string; auth: string }>(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
    [userId],
  )

  let sent = 0
  let pruned = 0

  for (const row of rows) {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 },
      )
      sent += 1
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        await removeSubscription(row.endpoint, sql)
        pruned += 1
      } else {
        /*
         * Kegagalan lain dicatat tapi tidak dilempar. Notifikasi adalah efek
         * samping; menggagalkan pembayaran karena push-nya tidak terkirim
         * adalah kerugian yang jauh lebih besar daripada notifikasi yang
         * hilang.
         */
        console.warn('[push]', status ?? 'gagal', row.endpoint.slice(0, 60))
      }
    }
  }

  return { sent, pruned, delivered: sent > 0 }
}

/** Dipakai klien untuk berlangganan; kunci privat tidak pernah dikirim. */
export function publicKey(): string | null {
  return config.vapid.publicKey ?? null
}
