import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import webpush from 'web-push'
import { createApp } from '../src/app.ts'
import { db, resetDatabase } from '../src/db.ts'
import { countSubscriptions, pushConfigured, saveSubscription, sendPush } from '../src/push.ts'

/**
 * Notifikasi push.
 *
 * Yang **tidak** bisa diuji di sini: pengiriman sungguhan. Itu menuntut
 * layanan push peramban (FCM, Mozilla autopush) yang bisa dihubungi dari
 * jaringan, dan langganan asli dari peramban sungguhan. Yang diuji adalah
 * semua yang ada di sisi kita: penyimpanan langganan, penolakan saat belum
 * dikonfigurasi, dan pembuangan langganan yang penerimanya sudah tidak ada.
 */
let server: Server
let base: string

beforeAll(async () => {
  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('gagal mengikat port')
  base = `http://127.0.0.1:${address.port}`
})

afterAll(() => new Promise((resolve) => server.close(() => resolve(null))))
afterEach(async () => {
  await resetDatabase()
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
  return { status: response.status, body: (parsed ?? {}) as Body }
}

const get = (p: string, t?: string) => send('GET', p, undefined, t)
const post = (p: string, b: unknown, t?: string) => send('POST', p, b, t)

async function signIn(phone = '08128845180') {
  const requested = await post('/api/auth/phone/request-otp', { phone })
  const verified = await post('/api/auth/phone/verify-otp', {
    phone,
    code: requested.body.devCode as string,
    name: 'Raka',
  })
  await db.run('DELETE FROM otp_codes')
  return { token: verified.body.token as string, userId: (verified.body.user as Body).id as string }
}

const SUBSCRIPTION = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/contoh-endpoint-1',
  keys: { p256dh: 'BExampleKeyMaterialForTesting0000000000000000', auth: 'authRahasia123' },
}

describe('kunci VAPID', () => {
  it('menyebut push tidak tersedia kalau kuncinya belum diisi', async () => {
    const status = await get('/api/auth/push/key')
    expect(status.status).toBe(200)
    /*
     * Tes berjalan tanpa VAPID_*. Yang diperiksa di sini adalah server
     * mengatakannya apa adanya — layar akan menampilkan alasannya, bukan
     * tombol yang tidak akan pernah bekerja.
     */
    expect(status.body.available).toBe(pushConfigured())
    if (!pushConfigured()) expect(status.body.publicKey).toBeNull()
  })

  it('tidak pernah mengirim kunci privat', async () => {
    const status = await get('/api/auth/push/key')
    expect(JSON.stringify(status.body)).not.toContain('privateKey')
  })
})

describe('berlangganan', () => {
  it('menolak tanpa sesi', async () => {
    expect((await post('/api/auth/push/subscribe', SUBSCRIPTION)).status).toBe(401)
  })

  it('menolak dengan jujur kalau server belum dikonfigurasi', async () => {
    const { token } = await signIn()
    const result = await post('/api/auth/push/subscribe', SUBSCRIPTION, token)

    if (pushConfigured()) {
      expect(result.status).toBe(200)
    } else {
      // Bukan gagal diam-diam: 501 dengan alasannya.
      expect(result.status).toBe(501)
      expect(result.body.code).toBe('PUSH_NOT_CONFIGURED')
    }
  })

  it('menolak muatan langganan yang tidak lengkap', async () => {
    const { token } = await signIn()
    const rusak = await post('/api/auth/push/subscribe', { endpoint: 'bukan-url' }, token)
    // 422 kalau dikonfigurasi, 501 kalau belum — keduanya bukan 200.
    expect(rusak.status).not.toBe(200)
  })
})

/**
 * Penyimpanan langganan diuji lewat fungsinya, bukan lewat HTTP: endpoint-nya
 * menolak sebelum sampai ke sini kalau VAPID belum diisi, sementara aturan
 * penyimpanannya berlaku apa pun konfigurasinya.
 */
describe('penyimpanan langganan', () => {
  it('menyimpan satu baris per endpoint, bukan satu per pemanggilan', async () => {
    const { userId } = await signIn()

    await saveSubscription(userId, SUBSCRIPTION, 'Chrome')
    await saveSubscription(userId, SUBSCRIPTION, 'Chrome')

    // Peramban mendaftar ulang tiap kali service worker-nya aktif.
    expect(await countSubscriptions(userId)).toBe(1)
  })

  it('memindahkan langganan ke pemilik baru kalau perangkatnya berpindah tangan', async () => {
    const pertama = await signIn('08128845181')
    const kedua = await signIn('08128845182')

    await saveSubscription(pertama.userId, SUBSCRIPTION, 'Chrome')
    await saveSubscription(kedua.userId, SUBSCRIPTION, 'Chrome')

    /*
     * Satu peramban punya satu endpoint. Membiarkan keduanya berarti
     * notifikasi pemilik lama tetap sampai ke perangkat yang sudah berganti
     * tangan.
     */
    expect(await countSubscriptions(pertama.userId)).toBe(0)
    expect(await countSubscriptions(kedua.userId)).toBe(1)
  })

  it('ikut terhapus saat akunnya hilang', async () => {
    const { userId } = await signIn()
    await saveSubscription(userId, SUBSCRIPTION, 'Chrome')

    await db.run('DELETE FROM users WHERE id = ?', [userId])
    expect(await countSubscriptions(userId)).toBe(0)
  })
})

describe('mengirim', () => {
  it('tidak melempar kalau belum dikonfigurasi, cuma melaporkan tidak terkirim', async () => {
    const { userId } = await signIn()
    await saveSubscription(userId, SUBSCRIPTION, 'Chrome')

    const result = await sendPush(userId, { title: 'Halo', body: 'Uji' })
    if (!pushConfigured()) {
      /*
       * Notifikasi adalah efek samping. Melempar dari sini akan menjatuhkan
       * konfirmasi booking hanya karena push-nya tidak bisa dikirim.
       */
      expect(result.delivered).toBe(false)
      expect(result.sent).toBe(0)
    }
  })

  it('tidak mencoba mengirim ke user tanpa langganan', async () => {
    const { userId } = await signIn()
    const result = await sendPush(userId, { title: 'Halo', body: 'Uji' })
    expect(result.sent).toBe(0)
  })
})

/**
 * Kunci VAPID dibuat sekali dan disimpan, bukan dibangkitkan tiap start.
 * Yang diuji: pustakanya memang menghasilkan pasangan kunci yang berbeda tiap
 * panggilan — itulah alasan ia tidak boleh dipanggil saat boot.
 */
describe('kenapa kunci tidak dibangkitkan otomatis', () => {
  it('menghasilkan pasangan berbeda tiap dipanggil', () => {
    const a = webpush.generateVAPIDKeys()
    const b = webpush.generateVAPIDKeys()
    /*
     * Kunci publiknya tersimpan di setiap langganan peramban. Membangkitkan
     * ulang tiap restart membuat seluruh langganan yang ada jadi tidak bisa
     * dipakai, tanpa satu pun tanda bahwa itu yang terjadi.
     */
    expect(a.publicKey).not.toBe(b.publicKey)
    expect(a.publicKey.length).toBeGreaterThan(40)
  })
})
