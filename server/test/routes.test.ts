import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { createApp } from '../src/app.ts'
import { resetDatabase } from '../src/db.ts'

/**
 * Tes ini menembak app Express yang sama dengan yang dijalankan produksi,
 * lewat HTTP sungguhan. Yang diuji bukan cuma logikanya, tapi juga
 * perkabelannya: rute, kode status, dan bentuk balasan.
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
afterEach(() => resetDatabase())

async function post(path: string, body: unknown, token?: string) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

async function get(path: string, token?: string) {
  const response = await fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    redirect: 'manual',
  })
  const text = await response.text()
  let parsed: Record<string, unknown> | null = null
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }
  return { status: response.status, body: parsed, location: response.headers.get('location') }
}

const PHONE = '08128845119'

describe('GET /api/auth/providers', () => {
  it('menyebut metode mana yang siap dan lewat saluran apa', async () => {
    const { status, body } = await get('/api/auth/providers')
    expect(status).toBe(200)
    expect(body).toMatchObject({ phone: true, email: true })
    // Tanpa kredensial, keduanya harus jujur melaporkan diri belum siap.
    expect(body!.google).toBe(false)
    expect(body!.facebook).toBe(false)
    expect(body!.smsDelivery).toBe('log')
  })
})

describe('masuk dengan nomor HP', () => {
  it('menyelesaikan alur minta kode → verifikasi → sesi', async () => {
    const requested = await post('/api/auth/phone/request-otp', { phone: PHONE })
    expect(requested.status).toBe(200)
    expect(requested.body.phone).toBe('+628128845119')
    expect(requested.body.delivery).toBe('log')

    const code = requested.body.devCode as unknown as string
    expect(code).toMatch(/^\d{6}$/)

    const verified = await post('/api/auth/phone/verify-otp', { phone: PHONE, code, name: 'Raka' })
    expect(verified.status).toBe(200)
    expect(verified.body.token).toBeTruthy()
    expect(verified.body.user).toMatchObject({ name: 'Raka', phoneVerified: true })

    const me = await get('/api/auth/me', verified.body.token as unknown as string)
    expect(me.status).toBe(200)
    expect(me.body!.user).toMatchObject({ phone: '+628128845119' })
  })

  it('memperlakukan format nomor yang berbeda sebagai satu orang', async () => {
    const first = await post('/api/auth/phone/request-otp', { phone: PHONE })
    expect(first.status).toBe(200)

    /*
     * Ditulis lain, orang yang sama — jadi permintaan kedua harus kena
     * cooldown yang sama. Ini sekaligus membuktikan normalisasi nomor
     * benar-benar sampai ke rate limiter, bukan berhenti di validasi.
     */
    const second = await post('/api/auth/phone/request-otp', { phone: '+62 812 8845 119' })
    expect(second.status).toBe(429)
    expect(second.body.code).toBe('COOLDOWN')

    // Dan kode dari permintaan pertama berlaku untuk format penulisan mana pun.
    const signedIn = await post('/api/auth/phone/verify-otp', {
      phone: '0812-8845-119',
      code: first.body.devCode,
      name: 'Raka',
    })
    expect(signedIn.status).toBe(200)
    expect(signedIn.body.user).toMatchObject({ phone: '+628128845119' })
  })

  it('menolak nomor yang tidak valid', async () => {
    const { status, body } = await post('/api/auth/phone/request-otp', { phone: '0217654321' })
    expect(status).toBe(422)
    expect(body.code).toBe('INVALID_PHONE')
  })

  it('menolak kode salah dan menyebut sisa percobaan', async () => {
    const requested = await post('/api/auth/phone/request-otp', { phone: PHONE })
    const wrong = requested.body.devCode === '000000' ? '111111' : '000000'

    const { status, body } = await post('/api/auth/phone/verify-otp', { phone: PHONE, code: wrong })
    expect(status).toBe(422)
    expect(body.code).toBe('WRONG')
    expect(body.attemptsLeft).toBe(4)
  })

  it('menolak kode yang bukan 6 angka sebelum menyentuh database', async () => {
    const { status } = await post('/api/auth/phone/verify-otp', { phone: PHONE, code: 'abcdef' })
    expect(status).toBe(422)
  })

  it('menahan permintaan kode yang beruntun', async () => {
    await post('/api/auth/phone/request-otp', { phone: PHONE })
    const { status, body } = await post('/api/auth/phone/request-otp', { phone: PHONE })
    expect(status).toBe(429)
    expect(body.code).toBe('COOLDOWN')
    expect(body.retryAfterSeconds).toBeGreaterThan(0)
  })
})

describe('daftar & masuk dengan email', () => {
  const akun = { name: 'Rani', email: 'rani@email.com', password: 'rahasia123' }

  it('mendaftar, memberi sesi, lalu memverifikasi email', async () => {
    const registered = await post('/api/auth/email/register', akun)
    expect(registered.status).toBe(200)
    expect(registered.body.user).toMatchObject({ email: 'rani@email.com', emailVerified: false })

    const verified = await post('/api/auth/email/verify', { token: registered.body.devToken })
    expect(verified.status).toBe(200)
    expect((verified.body.user as { emailVerified: boolean }).emailVerified).toBe(true)
  })

  it('menolak email yang sudah dipakai', async () => {
    await post('/api/auth/email/register', akun)
    const { status, body } = await post('/api/auth/email/register', akun)
    expect(status).toBe(409)
    expect(body.code).toBe('EMAIL_TAKEN')
  })

  it('menolak kata sandi lemah', async () => {
    const { status, body } = await post('/api/auth/email/register', { ...akun, password: 'pendek' })
    expect(status).toBe(422)
    expect(body.code).toBe('WEAK_PASSWORD')
  })

  it('masuk dengan sandi benar', async () => {
    await post('/api/auth/email/register', akun)
    const { status, body } = await post('/api/auth/email/login', {
      email: 'RANI@Email.com',
      password: akun.password,
    })
    expect(status).toBe(200)
    expect(body.token).toBeTruthy()
  })

  it('memberi pesan yang sama untuk email asing dan sandi salah', async () => {
    await post('/api/auth/email/register', akun)

    const salahSandi = await post('/api/auth/email/login', { ...akun, password: 'salah123' })
    const tidakAda = await post('/api/auth/email/login', {
      email: 'entah@email.com',
      password: 'rahasia123',
    })

    // Membedakan keduanya akan membocorkan alamat mana yang terdaftar.
    expect(salahSandi.status).toBe(401)
    expect(tidakAda.status).toBe(401)
    expect(salahSandi.body.message).toBe(tidakAda.body.message)
  })

  it('menolak token verifikasi yang sudah dipakai', async () => {
    const registered = await post('/api/auth/email/register', akun)
    await post('/api/auth/email/verify', { token: registered.body.devToken })

    const lagi = await post('/api/auth/email/verify', { token: registered.body.devToken })
    expect(lagi.status).toBe(410)
  })
})

describe('OAuth tanpa kredensial', () => {
  it('melaporkan diri belum dikonfigurasi, bukan gagal diam-diam', async () => {
    for (const provider of ['google', 'facebook']) {
      const { status, body } = await get(`/api/auth/oauth/${provider}/start`)
      expect(status).toBe(501)
      expect(body!.code).toBe('PROVIDER_NOT_CONFIGURED')
      // Pesannya harus menyebut variabel mana yang perlu diisi.
      expect(body!.message).toContain('CLIENT_ID')
    }
  })

  it('menolak penyedia yang tidak dikenal', async () => {
    const { status } = await get('/api/auth/oauth/twitter/start')
    expect(status).toBe(404)
  })

  it('menolak callback dengan state karangan', async () => {
    const { status, location } = await get(
      '/api/auth/oauth/google/callback?code=abc&state=palsu',
    )
    expect(status).toBe(302)
    expect(location).toContain('error=bad_state')
  })
})

describe('sesi', () => {
  it('menolak permintaan tanpa token', async () => {
    const { status } = await get('/api/auth/me')
    expect(status).toBe(401)
  })

  it('mencabut sesi saat keluar', async () => {
    const requested = await post('/api/auth/phone/request-otp', { phone: PHONE })
    const signedIn = await post('/api/auth/phone/verify-otp', {
      phone: PHONE,
      code: requested.body.devCode,
    })
    const token = signedIn.body.token as unknown as string

    expect((await get('/api/auth/me', token)).status).toBe(200)
    expect((await post('/api/auth/logout', {}, token)).status).toBe(200)
    expect((await get('/api/auth/me', token)).status).toBe(401)
  })
})
