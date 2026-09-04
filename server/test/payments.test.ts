import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { createHash } from 'node:crypto'
import { createApp } from '../src/app.ts'
import { db, resetDatabase } from '../src/db.ts'
import { seedDomain } from '../src/domain/store.ts'
import { truncateDomain } from '../src/domain/schema.ts'
import { MidtransProvider, SimulatorProvider } from '../src/payments/index.ts'

/**
 * Gerbang pembayaran.
 *
 * Yang diuji di sini bukan "tombol bayar jalan" — melainkan hal-hal yang
 * membuat uang tidak bisa dipalsukan: jumlah datang dari catatan, hanya
 * webhook bertanda tangan yang menyatakan lunas, dan pengiriman ulang tidak
 * menghitung dua kali.
 */
let server: Server
let base: string

beforeAll(async () => {
  await seedDomain()
  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('gagal mengikat port')
  base = `http://127.0.0.1:${address.port}`
})

afterAll(() => new Promise((resolve) => server.close(() => resolve(null))))
afterEach(async () => {
  await resetDatabase()
  await truncateDomain(db)
  await seedDomain()
})

type Body = Record<string, unknown>

async function send(method: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let parsed: unknown = null
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }
  return { status: response.status, body: (parsed ?? {}) as Body, list: (parsed ?? []) as Body[] }
}

const get = (p: string, t?: string) => send('GET', p, undefined, t)
const post = (p: string, b: unknown, t?: string) => send('POST', p, b, t)

/** Kiriman webhook mentah, persis seperti yang dikirim penyedia. */
async function webhook(payload: unknown) {
  const response = await fetch(`${base}/api/payments/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { status: response.status, body: (await response.json()) as Body }
}

async function signIn(phone: string, name: string): Promise<string> {
  const requested = await post('/api/auth/phone/request-otp', { phone })
  const verified = await post('/api/auth/phone/verify-otp', {
    phone,
    code: requested.body.devCode as string,
    name,
  })
  await db.run('DELETE FROM otp_codes')
  return verified.body.token as string
}

const RAKA = '08128845170'
const DIMAS = '08128845171'

async function bookingFor(token: string) {
  const venues = await get('/api/venues', token)
  const venue = venues.list[0] as unknown as { id: string; courts: { id: string }[] }
  const courtId = venue.courts[0]!.id

  const besok = new Date()
  besok.setDate(besok.getDate() + 2)
  const slots = await get(
    `/api/venues/${venue.id}/slots?courtId=${courtId}&date=${besok.toISOString()}`,
    token,
  )
  const startsAt = String(slots.list.find((s) => s.status === 'available')!.startsAt)

  const created = await post(
    '/api/bookings',
    {
      venueId: venue.id,
      courtId,
      startsAt: [startsAt],
      recurrenceWeeks: 1,
      addOnIds: [],
      pointsRedeemed: 0,
    },
    token,
  )
  return created.body
}

describe('membuat tagihan', () => {
  it('menghitung jumlahnya dari booking, bukan dari permintaan', async () => {
    const token = await signIn(RAKA, 'Raka')
    const booking = await bookingFor(token)

    const paid = await post(`/api/bookings/${booking.id}/pay`, { method: 'qris' }, token)
    expect(paid.status).toBe(201)

    const payment = paid.body.payment as Body
    // Tidak ada tempat di permintaan untuk menyebut angka; ini dari catatan.
    expect(payment.amountIdr).toBe(booking.totalIdr)
    expect(payment.status).toBe('pending')
  })

  it('mengatakan dirinya simulator, bukan berpura-pura jadi penyedia', async () => {
    const token = await signIn(RAKA, 'Raka')
    const booking = await bookingFor(token)
    const paid = await post(`/api/bookings/${booking.id}/pay`, { method: 'qris' }, token)

    const payment = paid.body.payment as Body
    expect(payment.provider).toBe('simulator')
    // QR-nya pun menyebut dirinya simulasi, bukan format QRIS yang tampak sah.
    expect(String(payment.qrString)).toContain('SIMULASI')
  })

  it('tidak mengonfirmasi booking sebelum ada pembayaran masuk', async () => {
    const token = await signIn(RAKA, 'Raka')
    const booking = await bookingFor(token)
    await post(`/api/bookings/${booking.id}/pay`, { method: 'qris' }, token)

    // Inilah yang dulu salah: menekan Bayar langsung mengonfirmasi.
    const after = await get(`/api/bookings/${booking.id}`, token)
    expect(after.body.status).toBe('awaitingPayment')
    expect(Number((await get('/api/me', token)).body.points)).toBe(0)
  })

  it('memakai ulang tagihan yang masih hidup, bukan membuat yang kedua', async () => {
    const token = await signIn(RAKA, 'Raka')
    const booking = await bookingFor(token)

    const first = await post(`/api/bookings/${booking.id}/pay`, { method: 'qris' }, token)
    const second = await post(`/api/bookings/${booking.id}/pay`, { method: 'qris' }, token)

    // Dua tagihan untuk satu booking berarti dua pembayaran bisa masuk, dan
    // yang kedua tidak punya apa-apa untuk dikonfirmasi.
    expect((second.body.payment as Body).id).toBe((first.body.payment as Body).id)
    expect((await get('/api/payments', token)).list).toHaveLength(1)
  })

  it('menolak menagih booking milik orang lain', async () => {
    const raka = await signIn(RAKA, 'Raka')
    const dimas = await signIn(DIMAS, 'Dimas')
    const booking = await bookingFor(raka)

    expect((await post(`/api/bookings/${booking.id}/pay`, { method: 'qris' }, dimas)).status).toBe(
      404,
    )
  })
})

describe('webhook', () => {
  async function pendingPayment(token: string) {
    const booking = await bookingFor(token)
    const paid = await post(`/api/bookings/${booking.id}/pay`, { method: 'qris' }, token)
    return { booking, payment: paid.body.payment as Body }
  }

  it('menolak muatan tanpa tanda tangan yang sah', async () => {
    const token = await signIn(RAKA, 'Raka')
    const { payment } = await pendingPayment(token)

    const palsu = await webhook({
      paymentId: payment.id,
      status: 'settled',
      amountIdr: payment.amountIdr,
      signature: 'jelas-bukan-tanda-tangan',
    })
    expect(palsu.status).toBe(401)

    // Dan booking-nya tetap belum dibayar.
    const after = await get(`/api/bookings/${(payment as Body).refId}`, token)
    expect(after.body.status).toBe('awaitingPayment')
  })

  it('menolak jumlah yang tidak cocok dengan yang ditagihkan', async () => {
    const token = await signIn(RAKA, 'Raka')
    const { payment } = await pendingPayment(token)
    const provider = new SimulatorProvider(
      process.env.TOKEN_PEPPER ?? 'pepper-pengembangan-jangan-dipakai-produksi',
    )

    const kecil = 1_000
    const ditolak = await webhook({
      paymentId: payment.id,
      status: 'settled',
      amountIdr: kecil,
      signature: provider.sign(String(payment.id), 'settled', kecil),
    })
    /*
     * Tanda tangannya sah — muatan ini memang dirakit dengan kunci yang benar
     * — tapi angkanya bukan yang ditagihkan. Membayar seribu rupiah untuk
     * lapangan dua ratus ribu tidak boleh lolos hanya karena tanda tangannya
     * cocok.
     */
    expect(ditolak.body.ok).toBe(false)
    expect(ditolak.body.reason).toBe('amountMismatch')
  })

  it('mengonfirmasi booking dan memberi poin saat lunas', async () => {
    const token = await signIn(RAKA, 'Raka')
    const { booking, payment } = await pendingPayment(token)

    const settled = await post(`/api/payments/${payment.id}/simulate`, { status: 'settled' }, token)
    expect(settled.body.status).toBe('settled')

    const after = await get(`/api/bookings/${booking.id}`, token)
    expect(after.body.status).toBe('confirmed')
    expect(Number((await get('/api/me', token)).body.points)).toBeGreaterThan(0)
  })

  it('tidak menghitung dua kali kalau webhooknya dikirim ulang', async () => {
    const token = await signIn(RAKA, 'Raka')
    const { payment } = await pendingPayment(token)

    await post(`/api/payments/${payment.id}/simulate`, { status: 'settled' }, token)
    const poin = Number((await get('/api/me', token)).body.points)

    // Penyedia mengirim ulang apa pun yang tidak dijawab 2xx.
    await post(`/api/payments/${payment.id}/simulate`, { status: 'settled' }, token)
    expect(Number((await get('/api/me', token)).body.points)).toBe(poin)
  })

  it('tidak membiarkan webhook `expire` yang telat membatalkan yang sudah lunas', async () => {
    const token = await signIn(RAKA, 'Raka')
    const { booking, payment } = await pendingPayment(token)

    await post(`/api/payments/${payment.id}/simulate`, { status: 'settled' }, token)
    await post(`/api/payments/${payment.id}/simulate`, { status: 'expired' }, token)

    expect((await get(`/api/payments/${payment.id}`, token)).body.status).toBe('settled')
    expect((await get(`/api/bookings/${booking.id}`, token)).body.status).toBe('confirmed')
  })

  it('mengunci slot hanya setelah lunas', async () => {
    const raka = await signIn(RAKA, 'Raka')
    const dimas = await signIn(DIMAS, 'Dimas')
    const { booking, payment } = await pendingPayment(raka)

    /*
     * Selama belum dibayar, jamnya masih terbuka untuk orang lain. Mengunci
     * slot saat tagihan dibuat berarti orang bisa memblokir lapangan tanpa
     * membayar sepeser pun.
     */
    const sebelum = await post(
      '/api/bookings',
      {
        venueId: booking.venueId,
        courtId: booking.courtId,
        startsAt: [(booking.range as Body).startsAt],
        recurrenceWeeks: 1,
        addOnIds: [],
        pointsRedeemed: 0,
      },
      dimas,
    )
    expect(sebelum.status).toBe(201)

    await post(`/api/payments/${payment.id}/simulate`, { status: 'settled' }, raka)

    const sesudah = await post(
      '/api/bookings',
      {
        venueId: booking.venueId,
        courtId: booking.courtId,
        startsAt: [(booking.range as Body).startsAt],
        recurrenceWeeks: 1,
        addOnIds: [],
        pointsRedeemed: 0,
      },
      dimas,
    )
    expect(sesudah.status).toBe(409)
  })
})

describe('pesanan toko lewat gerbang', () => {
  async function orderJersey(token: string) {
    return post(
      '/api/merch/m-jersey/order',
      { variantId: 'm-jersey-m', qty: 1, payMode: 'uang', paymentMethod: 'qris' },
      token,
    )
  }

  it('menahan poin belanja sampai pembayarannya masuk', async () => {
    const token = await signIn(RAKA, 'Raka')
    const order = await orderJersey(token)
    expect(Number((await get('/api/me', token)).body.points)).toBe(0)

    const charge = await post(
      '/api/payments',
      { kind: 'merch', refId: order.body.id, method: 'qris' },
      token,
    )
    await post(`/api/payments/${charge.body.id}/simulate`, { status: 'settled' }, token)

    expect(Number((await get('/api/me', token)).body.points)).toBe(185)
    const orders = await get('/api/merch-orders', token)
    expect(orders.list[0]!.status).toBe('disiapkan')
  })

  it('mengembalikan stok kalau pembayarannya gagal', async () => {
    const token = await signIn(RAKA, 'Raka')
    const sebelum = await get('/api/merch/m-jersey', token)
    const stokAwal = (sebelum.body.variants as { label: string; stock: number }[]).find(
      (v) => v.label === 'M',
    )!.stock

    const order = await orderJersey(token)
    const charge = await post(
      '/api/payments',
      { kind: 'merch', refId: order.body.id, method: 'qris' },
      token,
    )
    await post(`/api/payments/${charge.body.id}/simulate`, { status: 'expired' }, token)

    const sesudah = await get('/api/merch/m-jersey', token)
    const stokAkhir = (sesudah.body.variants as { label: string; stock: number }[]).find(
      (v) => v.label === 'M',
    )!.stock
    expect(stokAkhir).toBe(stokAwal)
  })

  it('menolak menagih pesanan yang ditebus poin', async () => {
    const token = await signIn(RAKA, 'Raka')
    await post('/api/me/points', { delta: 5_000 }, token)
    const order = await post(
      '/api/merch/m-tumbler/order',
      { variantId: 'm-tumbler-1', qty: 1, payMode: 'poin' },
      token,
    )

    const charge = await post(
      '/api/payments',
      { kind: 'merch', refId: order.body.id, method: 'qris' },
      token,
    )
    // Tidak ada uang yang berpindah, dan poinnya sudah dipotong saat dipesan.
    expect(charge.status).toBe(409)
    expect(charge.body.code).toBe('POINTS_ORDER')
  })
})

describe('iuran keanggotaan', () => {
  it('menerbitkan satu tagihan per periode, berapa kali pun diminta', async () => {
    const token = await signIn(RAKA, 'Raka')

    const first = await post('/api/dues/invoice', {}, token)
    const second = await post('/api/dues/invoice', {}, token)

    expect(first.body.id).toBe(second.body.id)
    expect((await get('/api/dues', token)).body.invoices).toHaveLength(1)
  })

  it('menjadikan orangnya anggota berbayar hanya setelah iurannya masuk', async () => {
    const token = await signIn(RAKA, 'Raka')
    const invoice = await post('/api/dues/invoice', {}, token)

    expect((await get('/api/me', token)).body.isMember).toBe(false)

    const charge = await post(
      '/api/payments',
      { kind: 'dues', refId: invoice.body.id, method: 'va' },
      token,
    )
    await post(`/api/payments/${charge.body.id}/simulate`, { status: 'settled' }, token)

    expect((await get('/api/me', token)).body.isMember).toBe(true)
    const dues = await get('/api/dues', token)
    expect((dues.body.invoices as Body[])[0]!.status).toBe('lunas')
  })

  it('menolak menagih ulang tagihan yang sudah lunas', async () => {
    const token = await signIn(RAKA, 'Raka')
    const invoice = await post('/api/dues/invoice', {}, token)
    const charge = await post(
      '/api/payments',
      { kind: 'dues', refId: invoice.body.id, method: 'va' },
      token,
    )
    await post(`/api/payments/${charge.body.id}/simulate`, { status: 'settled' }, token)

    const lagi = await post(
      '/api/payments',
      { kind: 'dues', refId: invoice.body.id, method: 'va' },
      token,
    )
    expect(lagi.status).toBe(409)
    expect(lagi.body.code).toBe('ALREADY_PAID')
  })

  it('tidak membocorkan tagihan orang lain', async () => {
    const raka = await signIn(RAKA, 'Raka')
    const dimas = await signIn(DIMAS, 'Dimas')
    const invoice = await post('/api/dues/invoice', {}, raka)

    const curi = await post(
      '/api/payments',
      { kind: 'dues', refId: invoice.body.id, method: 'va' },
      dimas,
    )
    expect(curi.status).toBe(404)
  })
})

/**
 * Verifikasi tanda tangan Midtrans diuji sebagai fungsi, tanpa jaringan.
 *
 * Ini bagian yang paling sering salah dan paling mahal kalau salah — muatan
 * yang lolos berarti siapa pun bisa menyatakan booking orang lain lunas.
 */
describe('tanda tangan Midtrans', () => {
  const serverKey = 'SB-Mid-server-kunci-uji'
  const provider = new MidtransProvider({ serverKey, clientKey: 'k', production: false })

  function signed(overrides: Record<string, unknown> = {}) {
    const body = {
      order_id: 'pay-123',
      status_code: '200',
      gross_amount: '150000.00',
      transaction_status: 'settlement',
      transaction_id: 'trx-1',
      ...overrides,
    }
    const signature = createHash('sha512')
      .update(`${body.order_id}${body.status_code}${body.gross_amount}${serverKey}`)
      .digest('hex')
    return JSON.stringify({ ...body, signature_key: signature, ...overrides })
  }

  it('menerima muatan yang ditandatangani kunci yang benar', () => {
    const event = provider.verifyWebhook(signed(), {})
    expect(event?.status).toBe('settled')
    expect(event?.amountIdr).toBe(150_000)
  })

  it('menolak tanda tangan yang dirakit kunci lain', () => {
    const lain = new MidtransProvider({
      serverKey: 'kunci-lain',
      clientKey: 'k',
      production: false,
    })
    expect(lain.verifyWebhook(signed(), {})).toBeNull()
  })

  it('menolak muatan yang diubah setelah ditandatangani', () => {
    const body = JSON.parse(signed()) as Record<string, unknown>
    body.gross_amount = '1000.00'
    expect(provider.verifyWebhook(JSON.stringify(body), {})).toBeNull()
  })

  it('menolak muatan tanpa tanda tangan sama sekali', () => {
    const body = JSON.parse(signed()) as Record<string, unknown>
    delete body.signature_key
    expect(provider.verifyWebhook(JSON.stringify(body), {})).toBeNull()
  })

  it('menolak yang bukan JSON', () => {
    expect(provider.verifyWebhook('bukan json', {})).toBeNull()
  })

  it('tidak menganggap capture yang tertahan pemeriksaan penipuan sebagai lunas', () => {
    /*
     * Transaksi kartu yang tertahan bisa dibatalkan belakangan. Mengonfirmasi
     * booking atas dasar itu berarti mengunci lapangan untuk uang yang belum
     * tentu jadi.
     */
    const tertahan = provider.verifyWebhook(
      signed({ transaction_status: 'capture', fraud_status: 'challenge' }),
      {},
    )
    expect(tertahan?.status).toBe('pending')

    const diterima = provider.verifyWebhook(
      signed({ transaction_status: 'capture', fraud_status: 'accept' }),
      {},
    )
    expect(diterima?.status).toBe('settled')
  })

  it('memetakan status gagal jadi gagal, bukan diabaikan', () => {
    for (const status of ['deny', 'cancel', 'failure', 'refund']) {
      expect(provider.verifyWebhook(signed({ transaction_status: status }), {})?.status).toBe(
        'failed',
      )
    }
    expect(provider.verifyWebhook(signed({ transaction_status: 'expire' }), {})?.status).toBe(
      'expired',
    )
  })
})
