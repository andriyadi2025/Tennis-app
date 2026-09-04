import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { createApp } from '../src/app.ts'
import { resetDatabase } from '../src/db.ts'

/**
 * Lupa sandi dan penyambungan akun, lewat HTTP sungguhan ke app yang sama
 * dengan yang dijalankan produksi.
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
  let parsed: Body = {}
  try {
    parsed = JSON.parse(text) as Body
  } catch {
    parsed = {}
  }
  return { status: response.status, body: parsed }
}

const post = (path: string, body: unknown, token?: string) => send('POST', path, body, token)
const get = (path: string, token?: string) => send('GET', path, undefined, token)
const del = (path: string, token?: string) => send('DELETE', path, undefined, token)

const EMAIL = 'raka@dbtc.test'
const PASSWORD = 'rahasia123'
const PHONE = '08128845119'

/** Akun email+sandi, dipakai sebagai titik awal sebagian besar kasus. */
async function registerEmailUser() {
  const { body } = await post('/api/auth/email/register', {
    name: 'Raka',
    email: EMAIL,
    password: PASSWORD,
  })
  return body.token as string
}

/** Akun yang hanya punya nomor HP — satu-satunya cara masuknya. */
async function registerPhoneUser(phone = PHONE) {
  const requested = await post('/api/auth/phone/request-otp', { phone })
  const verified = await post('/api/auth/phone/verify-otp', {
    phone,
    code: requested.body.devCode as string,
    name: 'Anggota',
  })
  return verified.body.token as string
}

describe('lupa kata sandi', () => {
  it('menyelesaikan alur minta kode → sandi baru → langsung masuk', async () => {
    await registerEmailUser()

    const forgot = await post('/api/auth/password/forgot', { email: EMAIL })
    expect(forgot.status).toBe(200)
    const token = forgot.body.devToken as string
    expect(token).toBeTruthy()

    const reset = await post('/api/auth/password/reset', { token, password: 'sandibaru9' })
    expect(reset.status).toBe(200)
    expect(reset.body.token).toBeTruthy()

    // Sandi lama tidak berlaku lagi, yang baru berlaku.
    const lama = await post('/api/auth/email/login', { email: EMAIL, password: PASSWORD })
    expect(lama.status).toBe(401)
    const baru = await post('/api/auth/email/login', { email: EMAIL, password: 'sandibaru9' })
    expect(baru.status).toBe(200)
  })

  it('menjawab sama untuk email terdaftar dan tidak, tanpa membocorkan mana yang ada', async () => {
    await registerEmailUser()
    const ada = await post('/api/auth/password/forgot', { email: EMAIL })
    const tidak = await post('/api/auth/password/forgot', { email: 'bukan-siapa-siapa@dbtc.test' })

    expect(ada.status).toBe(tidak.status)
    expect(ada.body.message).toBe(tidak.body.message)
    // Bedanya hanya devToken, yang tidak pernah ada di produksi.
    expect(tidak.body.devToken).toBeUndefined()
  })

  it('mencabut seluruh sesi lama, bukan cuma mengganti sandinya', async () => {
    const sesiLama = await registerEmailUser()
    expect((await get('/api/auth/me', sesiLama)).status).toBe(200)

    const forgot = await post('/api/auth/password/forgot', { email: EMAIL })
    await post('/api/auth/password/reset', {
      token: forgot.body.devToken as string,
      password: 'sandibaru9',
    })

    // Kalau sesi lama bertahan, mengatur ulang sandi tidak menolong siapa pun
    // yang akunnya sudah diambil alih.
    expect((await get('/api/auth/me', sesiLama)).status).toBe(401)
  })

  it('menolak sandi lemah tanpa menghanguskan kodenya', async () => {
    await registerEmailUser()
    const forgot = await post('/api/auth/password/forgot', { email: EMAIL })
    const token = forgot.body.devToken as string

    const lemah = await post('/api/auth/password/reset', { token, password: 'abc' })
    expect(lemah.status).toBe(422)

    // Kode sekali-pakai harus masih hidup: kesalahan mengetik sandi bukan
    // alasan memaksa orang meminta kode baru.
    const kedua = await post('/api/auth/password/reset', { token, password: 'sandibaru9' })
    expect(kedua.status).toBe(200)
  })

  it('menolak kode yang sudah dipakai', async () => {
    await registerEmailUser()
    const forgot = await post('/api/auth/password/forgot', { email: EMAIL })
    const token = forgot.body.devToken as string

    await post('/api/auth/password/reset', { token, password: 'sandibaru9' })
    const ulang = await post('/api/auth/password/reset', { token, password: 'sandilain9' })
    expect(ulang.status).toBe(410)
  })

  it('menandai email terverifikasi — yang bisa menerima kode terbukti pemiliknya', async () => {
    await registerEmailUser()
    const forgot = await post('/api/auth/password/forgot', { email: EMAIL })
    const reset = await post('/api/auth/password/reset', {
      token: forgot.body.devToken as string,
      password: 'sandibaru9',
    })
    expect((reset.body.user as Body).emailVerified).toBe(true)
  })
})

describe('menyambungkan nomor HP ke akun email', () => {
  it('menambah nomor sebagai cara masuk kedua', async () => {
    const token = await registerEmailUser()
    expect((await get('/api/auth/link', token)).body.methods).toEqual(['email'])

    const requested = await post('/api/auth/link/phone/request-otp', { phone: PHONE }, token)
    expect(requested.status).toBe(200)

    const verified = await post(
      '/api/auth/link/phone/verify',
      { phone: PHONE, code: requested.body.devCode as string },
      token,
    )
    expect(verified.status).toBe(200)
    expect(verified.body.methods).toEqual(['phone', 'email'])

    /*
     * Satu akun, dua penanda — itulah yang membuat masuk lewat nomor ini
     * mendarat di akun yang sama, karena verify-otp mencari user lewat nomor.
     *
     * Masuknya sendiri tidak dicoba di sini: minta OTP kedua untuk nomor yang
     * sama langsung kena jeda kirim-ulang 60 detik, dan jeda itu memang yang
     * diinginkan. Alur masuk lewat nomor sudah diuji terpisah.
     */
    const user = verified.body.user as Body
    expect(user.phone).toBe('+628128845119')
    expect(user.email).toBe(EMAIL)

    const kedua = await post('/api/auth/phone/request-otp', { phone: PHONE })
    expect(kedua.status).toBe(429)
  })

  it('menolak nomor yang sudah dipakai akun lain, bukan memindahkannya diam-diam', async () => {
    await registerPhoneUser()
    const emailToken = await registerEmailUser()

    const requested = await post('/api/auth/link/phone/request-otp', { phone: PHONE }, emailToken)
    expect(requested.status).toBe(409)
    // Memindahkan berarti memutuskan booking dan poin siapa yang bertahan.
    expect(requested.body.code).toBe('PHONE_TAKEN')
  })

  it('menolak permintaan tanpa sesi', async () => {
    const anon = await post('/api/auth/link/phone/request-otp', { phone: PHONE })
    expect(anon.status).toBe(401)
  })
})

describe('menyambungkan email ke akun nomor HP', () => {
  it('menuntut kata sandi — email saja tidak menambah cara masuk', async () => {
    const token = await registerPhoneUser()

    const tanpaSandi = await post('/api/auth/link/email', { email: EMAIL }, token)
    expect(tanpaSandi.status).toBe(422)
    expect(tanpaSandi.body.code).toBe('PASSWORD_REQUIRED')

    const dengan = await post('/api/auth/link/email', { email: EMAIL, password: PASSWORD }, token)
    expect(dengan.status).toBe(200)
    expect(dengan.body.methods).toEqual(['phone', 'email'])
  })

  it('menolak email milik akun lain', async () => {
    await registerEmailUser()
    const phoneToken = await registerPhoneUser('08129999999')

    const bentrok = await post(
      '/api/auth/link/email',
      { email: EMAIL, password: PASSWORD },
      phoneToken,
    )
    expect(bentrok.status).toBe(409)
    expect(bentrok.body.code).toBe('EMAIL_TAKEN')
  })
})

describe('melepas cara masuk', () => {
  it('menolak melepas satu-satunya cara masuk', async () => {
    const token = await registerEmailUser()
    const lepas = await del('/api/auth/link/email', token)

    // Tidak ada layar pemulihan yang bisa menolong akun tanpa cara masuk.
    expect(lepas.status).toBe(409)
    expect(lepas.body.code).toBe('LAST_METHOD')
    expect((await get('/api/auth/link', token)).body.methods).toEqual(['email'])
  })

  it('membolehkan melepas setelah ada cara masuk kedua', async () => {
    const token = await registerEmailUser()
    const requested = await post('/api/auth/link/phone/request-otp', { phone: PHONE }, token)
    await post(
      '/api/auth/link/phone/verify',
      { phone: PHONE, code: requested.body.devCode as string },
      token,
    )

    const lepas = await del('/api/auth/link/email', token)
    expect(lepas.status).toBe(200)
    expect(lepas.body.methods).toEqual(['phone'])

    // Sandinya ikut dibuang: sandi tanpa email tidak bisa dipakai di layar mana pun.
    const coba = await post('/api/auth/email/login', { email: EMAIL, password: PASSWORD })
    expect(coba.status).toBe(401)
  })

  it('menolak melepas cara masuk yang memang belum tersambung', async () => {
    const token = await registerEmailUser()
    const lepas = await del('/api/auth/link/google', token)
    expect(lepas.status).toBe(409)
    expect(lepas.body.code).toBe('NOT_LINKED')
  })

  it('menolak nama cara masuk yang tidak dikenal', async () => {
    const token = await registerEmailUser()
    expect((await del('/api/auth/link/telegram', token)).status).toBe(404)
  })
})

describe('menyambungkan penyedia OAuth', () => {
  it('menolak kalau penyedianya belum dikonfigurasi, bukan diam-diam gagal', async () => {
    const token = await registerEmailUser()
    const start = await get('/api/auth/link/google/start', token)
    expect(start.status).toBe(501)
    expect(start.body.code).toBe('PROVIDER_NOT_CONFIGURED')
  })

  it('menolak tanpa sesi', async () => {
    expect((await get('/api/auth/link/google/start')).status).toBe(401)
  })
})
