import { randomUUID } from 'node:crypto'
import type { Sql } from '../store/index.ts'
import { db } from '../db.ts'
import { paymentProvider } from '../payments/index.ts'
import type { PaymentKind, PaymentStatus, WebhookEvent } from '../payments/index.ts'
import * as store from './store.ts'
import { hoursOf } from './slots.ts'
import { publish } from './events.ts'
import { addWeeks, parseISO } from '../../../shared/dates.ts'
import { pointsEarned, tierFor } from '../../../shared/points.ts'
import { restoreStock } from '../../../shared/merch.ts'

/**
 * Pembayaran, dari tagihan sampai penyelesaian.
 *
 * Dua aturan yang menentukan benar-tidaknya seluruh berkas ini:
 *
 * 1. **Jumlahnya dari catatan, bukan dari permintaan.** Klien menyebut apa
 *    yang mau dibayar; berapa besarnya dibaca dari booking, pesanan, atau
 *    tagihan iuran yang tersimpan.
 *
 * 2. **Yang menyatakan lunas hanya webhook penyedia.** Klien yang kembali
 *    dari halaman pembayaran tidak membuktikan apa pun — halaman itu bisa
 *    dibuka siapa saja.
 */

/** Tagihan kedaluwarsa 15 menit; hold slot booking mengikutinya. */
export const PAYMENT_TTL_MS = 15 * 60 * 1_000

export interface PaymentRow {
  id: string
  user_id: string
  kind: PaymentKind
  ref_id: string
  amount_idr: number
  method: string
  provider: string
  provider_ref: string | null
  status: PaymentStatus
  redirect_url: string | null
  qr_string: string | null
  expires_at: string
  settled_at: string | null
  created_at: string
}

export interface PaymentView {
  id: string
  kind: PaymentKind
  refId: string
  amountIdr: number
  method: string
  status: PaymentStatus
  /** Saluran yang benar-benar dipakai — `simulator` bukan penyedia sungguhan. */
  provider: string
  redirectUrl: string | null
  qrString: string | null
  expiresAt: string
  settledAt: string | null
  createdAt: string
}

const view = (r: PaymentRow): PaymentView => ({
  id: r.id,
  kind: r.kind,
  refId: r.ref_id,
  amountIdr: Number(r.amount_idr),
  method: r.method,
  status: r.status,
  provider: r.provider,
  redirectUrl: r.redirect_url,
  qrString: r.qr_string,
  expiresAt: r.expires_at,
  settledAt: r.settled_at,
  createdAt: r.created_at,
})

export async function findPayment(id: string, sql: Sql = db): Promise<PaymentRow | undefined> {
  return sql.get<PaymentRow>('SELECT * FROM payments WHERE id = ?', [id])
}

export async function paymentFor(
  kind: PaymentKind,
  refId: string,
  sql: Sql = db,
): Promise<PaymentRow | undefined> {
  return sql.get<PaymentRow>(
    'SELECT * FROM payments WHERE kind = ? AND ref_id = ? ORDER BY created_at DESC LIMIT 1',
    [kind, refId],
  )
}

export async function listPayments(userId: string, sql: Sql = db): Promise<PaymentView[]> {
  const rows = await sql.all<PaymentRow>(
    'SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC',
    [userId],
  )
  return rows.map(view)
}

export { view as paymentView }

export interface ChargeTarget {
  kind: PaymentKind
  refId: string
  amountIdr: number
  description: string
}

/**
 * Membuat tagihan dan memintanya ke penyedia.
 *
 * Tagihan yang masih hidup untuk hal yang sama dipakai ulang, bukan dibuat
 * baru: dua tagihan untuk satu booking berarti dua kemungkinan pembayaran
 * masuk, dan yang kedua tidak punya apa-apa untuk dikonfirmasi.
 */
export async function createCharge(
  user: { id: string; name: string; email: string | null; phone: string | null },
  target: ChargeTarget,
  method: string,
  sql: Sql = db,
): Promise<PaymentView> {
  const existing = await paymentFor(target.kind, target.refId, sql)
  if (existing && existing.status === 'pending' && new Date(existing.expires_at) > new Date()) {
    return view(existing)
  }
  if (existing && existing.status === 'settled') {
    return view(existing)
  }

  const provider = paymentProvider()
  const id = `pay-${randomUUID().slice(0, 12)}`
  const expiresAt = new Date(Date.now() + PAYMENT_TTL_MS).toISOString()

  const charge = await provider.charge({
    paymentId: id,
    amountIdr: target.amountIdr,
    method,
    customer: user,
    description: target.description,
    expiresAt,
  })

  await sql.run(
    `INSERT INTO payments (id, user_id, kind, ref_id, amount_idr, method, provider, provider_ref,
       status, redirect_url, qr_string, expires_at, settled_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NULL, ?)`,
    [
      id,
      user.id,
      target.kind,
      target.refId,
      Math.round(target.amountIdr),
      method,
      charge.channel,
      charge.reference,
      charge.redirectUrl,
      charge.qrString,
      expiresAt,
      new Date().toISOString(),
    ],
  )

  return view((await findPayment(id, sql))!)
}

export type SettleOutcome =
  | { ok: true; payment: PaymentView; alreadyProcessed: boolean }
  | { ok: false; reason: 'unknown' | 'amountMismatch' | 'alreadySettled' }

/**
 * Menerapkan sebuah webhook.
 *
 * Idempoten lewat tabel `payment_events`: penyedia mengirim ulang saat ragu,
 * dan memproses ulang berarti mengkreditkan poin dua kali untuk satu
 * pembayaran. Yang menjadi kunci adalah id event dari penyedia — bukan waktu
 * kedatangan, yang selalu berbeda.
 */
export async function applyWebhook(event: WebhookEvent, sql: Sql = db): Promise<SettleOutcome> {
  const payment = await findPayment(event.paymentId, sql)
  if (!payment) return { ok: false, reason: 'unknown' }

  /*
   * Jumlah dicocokkan dengan yang ditagihkan. Penyedia yang melaporkan angka
   * berbeda berarti ada yang tidak beres — mungkin tagihan lain, mungkin
   * muatan yang dirakit orang lain — dan itu tidak boleh diam-diam diterima.
   */
  if (Math.round(event.amountIdr) !== Math.round(Number(payment.amount_idr))) {
    return { ok: false, reason: 'amountMismatch' }
  }

  const eventId = `${payment.id}:${event.status}:${event.reference}`
  const seen = await sql.get('SELECT 1 AS x FROM payment_events WHERE id = ?', [eventId])
  if (seen) return { ok: true, payment: view(payment), alreadyProcessed: true }

  await sql.run(
    'INSERT INTO payment_events (id, payment_id, status, raw, created_at) VALUES (?, ?, ?, ?, ?)',
    [eventId, payment.id, event.status, JSON.stringify(event.raw), new Date().toISOString()],
  )

  // Pembayaran yang sudah lunas tidak berubah lagi. Webhook `expire` yang
  // datang terlambat tidak boleh membatalkan booking yang sudah dibayar.
  if (payment.status === 'settled') {
    return { ok: true, payment: view(payment), alreadyProcessed: true }
  }

  const settledAt = event.status === 'settled' ? new Date().toISOString() : null
  await sql.run('UPDATE payments SET status = ?, settled_at = ?, provider_ref = ? WHERE id = ?', [
    event.status,
    settledAt,
    event.reference,
    payment.id,
  ])

  if (event.status === 'settled') await onSettled(payment, sql)
  else if (event.status === 'expired' || event.status === 'failed') await onFailed(payment, sql)

  return {
    ok: true,
    payment: view((await findPayment(payment.id, sql))!),
    alreadyProcessed: false,
  }
}

/** Yang terjadi setelah uangnya benar-benar masuk. */
async function onSettled(payment: PaymentRow, sql: Sql): Promise<void> {
  if (payment.kind === 'booking') await confirmBooking(payment, sql)
  else if (payment.kind === 'merch') await confirmMerchOrder(payment, sql)
  else if (payment.kind === 'dues') await confirmDues(payment, sql)

  publish('payment', payment.id, 'settled', { status: 'settled' })
}

/** Yang dilepas kembali kalau pembayarannya tidak jadi. */
async function onFailed(payment: PaymentRow, sql: Sql): Promise<void> {
  if (payment.kind === 'merch') await releaseMerchOrder(payment, sql)
  // Booking yang tidak dibayar tidak pernah mengunci slot, jadi tidak ada
  // yang perlu dilepas — slotnya baru diklaim saat lunas.
  publish('payment', payment.id, 'failed', { status: payment.status })
}

async function confirmBooking(payment: PaymentRow, sql: Sql): Promise<void> {
  const booking = await store.getBooking(payment.ref_id, payment.user_id, sql)
  if (!booking || booking.status === 'confirmed') return

  const hours = hoursOf(booking.range.startsAt, booking.range.hours)

  await sql.transaction(async (tx) => {
    await store.claimSlots(booking.courtId, hours, booking.id, tx)
    if (booking.recurrence) {
      for (let w = 1; w < booking.recurrence.weeks; w += 1) {
        await store.claimSlots(
          booking.courtId,
          hours.map((iso) => addWeeks(parseISO(iso), w).toISOString()),
          booking.id,
          tx,
        )
      }
    }
    await store.saveBooking(
      payment.user_id,
      {
        ...booking,
        status: 'confirmed',
        paymentMethod: payment.method as typeof booking.paymentMethod,
        paymentDeadline: null,
      },
      tx,
    )

    const row = await tx.get<{ points: number }>('SELECT points FROM profiles WHERE user_id = ?', [
      payment.user_id,
    ])
    // Poin yang ditukar baru benar-benar dipotong saat lunas: booking yang
    // tidak jadi tidak boleh menghanguskan poin.
    const next = Math.max(
      0,
      Number(row?.points ?? 0) + pointsEarned(booking.subtotalIdr) - booking.pointsRedeemed,
    )
    await tx.run('UPDATE profiles SET points = ?, tier = ? WHERE user_id = ?', [
      next,
      tierFor(next),
      payment.user_id,
    ])
  })

  await store.pushNotification(payment.user_id, {
    kind: 'booking',
    title: 'Booking terkonfirmasi',
    body: `${booking.venueName} · ${booking.courtName}. Kode ${booking.code}.`,
    href: `/booking/${booking.id}/ticket`,
  })
}

async function confirmMerchOrder(payment: PaymentRow, sql: Sql): Promise<void> {
  const found = await store.getMerchOrder(payment.ref_id, sql)
  if (!found || found.order.status !== 'menunggu') return

  await sql.transaction(async (tx) => {
    await store.saveMerchOrder(found.userId, { ...found.order, status: 'disiapkan' }, tx)
    const row = await tx.get<{ points: number }>('SELECT points FROM profiles WHERE user_id = ?', [
      found.userId,
    ])
    const next = Math.max(0, Number(row?.points ?? 0) + found.order.pointsEarned)
    await tx.run('UPDATE profiles SET points = ?, tier = ? WHERE user_id = ?', [
      next,
      tierFor(next),
      found.userId,
    ])
  })

  await store.pushNotification(found.userId, {
    kind: 'promo',
    title: 'Pesanan toko dibayar',
    body: `${found.order.itemName} sedang disiapkan. Kode ambil ${found.order.code}.`,
    href: '/toko/pesanan',
  })
}

/** Pesanan yang pembayarannya gagal melepas stoknya kembali. */
async function releaseMerchOrder(payment: PaymentRow, sql: Sql): Promise<void> {
  const found = await store.getMerchOrder(payment.ref_id, sql)
  if (!found || found.order.status !== 'menunggu') return

  await sql.transaction(async (tx) => {
    await store.saveMerchOrder(found.userId, { ...found.order, status: 'batal' }, tx)
    const item = await store.findMerchItem(found.order.itemId, tx)
    if (item) {
      await store.saveMerchItem(restoreStock(item, found.order.variantId, found.order.qty), tx)
    }
    // Poin yang sempat ditukar dikembalikan; poin belanja belum pernah
    // diberikan, jadi tidak ada yang perlu ditarik.
    if (found.order.pointsSpent > 0) {
      const row = await tx.get<{ points: number }>(
        'SELECT points FROM profiles WHERE user_id = ?',
        [found.userId],
      )
      const next = Number(row?.points ?? 0) + found.order.pointsSpent
      await tx.run('UPDATE profiles SET points = ?, tier = ? WHERE user_id = ?', [
        next,
        tierFor(next),
        found.userId,
      ])
    }
  })
}

async function confirmDues(payment: PaymentRow, sql: Sql): Promise<void> {
  await sql.transaction(async (tx) => {
    await tx.run("UPDATE dues_invoices SET status = 'lunas', paid_at = ? WHERE id = ?", [
      new Date().toISOString(),
      payment.ref_id,
    ])
    // Membayar iuran itulah yang membuat seseorang jadi anggota berbayar.
    await tx.run('UPDATE profiles SET is_member = 1 WHERE user_id = ?', [payment.user_id])
  })

  await store.pushNotification(payment.user_id, {
    kind: 'payment',
    title: 'Iuran diterima',
    body: 'Keanggotaan kamu aktif. Potongan tarif anggota berlaku mulai sekarang.',
    href: '/profile',
  })
}

/**
 * Menutup tagihan yang lewat batas waktu.
 *
 * Dijalankan berkala, bukan di jalur permintaan. Tanpa ini, tagihan yang
 * ditinggalkan orangnya akan selamanya berstatus `pending` dan stok pesanan
 * toko tidak pernah kembali ke katalog.
 */
export async function expireStalePayments(sql: Sql = db): Promise<number> {
  const rows = await sql.all<PaymentRow>(
    "SELECT * FROM payments WHERE status = 'pending' AND expires_at < ?",
    [new Date().toISOString()],
  )
  for (const row of rows) {
    await sql.run("UPDATE payments SET status = 'expired' WHERE id = ?", [row.id])
    await onFailed({ ...row, status: 'expired' }, sql)
  }
  return rows.length
}
