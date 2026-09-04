import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { createApp } from '../src/app.ts'
import { db, resetDatabase } from '../src/db.ts'
import { seedDomain } from '../src/domain/store.ts'
import { truncateDomain } from '../src/domain/schema.ts'

/**
 * Menggabungkan dua akun yang terlanjur terpisah.
 *
 * Ini satu-satunya operasi di app ini yang **tidak bisa dibatalkan**, jadi
 * yang diuji bukan cuma "berhasil" melainkan apa saja yang selamat dan apa
 * yang sengaja dibuang.
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
const del = (p: string, t?: string) => send('DELETE', p, undefined, t)

const PHONE = '08128845150'
const EMAIL = 'raka@dbtc.test'
const PASSWORD = 'rahasia123'

/**
 * Akun lewat nomor HP saja.
 *
 * Jejak OTP-nya dibersihkan setelah akun jadi. Bukan karena jeda kirim-ulang
 * 60 detik itu salah — justru itu yang diinginkan — melainkan karena yang
 * diuji di berkas ini penggabungan akun, dan menunggu semenit di tiap kasus
 * hanya menguji `setTimeout`.
 */
async function phoneAccount(phone = PHONE, name = 'Raka HP') {
  const requested = await post('/api/auth/phone/request-otp', { phone })
  const verified = await post('/api/auth/phone/verify-otp', {
    phone,
    code: requested.body.devCode as string,
    name,
  })
  // Dihapus semua, bukan per nomor: tabelnya menyimpan bentuk E.164 sementara
  // yang dikirim tes bentuk nasional, jadi mencocokkannya mudah meleset.
  await db.run('DELETE FROM otp_codes')
  return verified.body.token as string
}

/** Akun lewat email saja. */
async function emailAccount(email = EMAIL, name = 'Raka Email') {
  const { body } = await post('/api/auth/email/register', { name, email, password: PASSWORD })
  return body.token as string
}

/** Menyelesaikan penggabungan akun bernomor `phone` ke akun `token`. */
async function merge(token: string, phone = PHONE) {
  const requested = await post('/api/auth/merge/request-otp', { phone }, token)
  if (requested.status !== 200) return requested
  return post('/api/auth/merge/confirm', { phone, code: requested.body.devCode as string }, token)
}

describe('syarat sebelum menggabungkan', () => {
  it('menolak nomor yang tidak dipakai akun mana pun', async () => {
    const token = await emailAccount()
    const attempt = await post('/api/auth/merge/request-otp', { phone: '08129999999' }, token)
    expect(attempt.status).toBe(404)
    // Kalau nomornya memang bebas, yang dibutuhkan menyambung — bukan menggabung.
    expect(attempt.body.code).toBe('NO_SUCH_ACCOUNT')
  })

  it('menolak nomor milik akun itu sendiri', async () => {
    const token = await phoneAccount()
    const attempt = await post('/api/auth/merge/request-otp', { phone: PHONE }, token)
    expect(attempt.status).toBe(409)
    expect(attempt.body.code).toBe('SAME_ACCOUNT')
  })

  it('menolak sebelum kode dikirim kalau slot nomornya sudah terisi', async () => {
    await phoneAccount()
    const lain = await phoneAccount('08128845151', 'Orang Lain')

    const attempt = await post('/api/auth/merge/request-otp', { phone: PHONE }, lain)
    /*
     * Diperiksa lebih dulu: menemukan syaratnya setelah orangnya membuka SMS
     * dan mengetik enam angka adalah cara buruk menyampaikan sesuatu yang
     * sudah pasti sejak awal.
     */
    expect(attempt.status).toBe(409)
    expect(attempt.body.code).toBe('SLOT_TAKEN')
    expect(attempt.body.devCode).toBeUndefined()
  })

  it('menolak tanpa sesi', async () => {
    expect((await post('/api/auth/merge/request-otp', { phone: PHONE })).status).toBe(401)
  })

  it('menolak kode yang salah, dan tidak menggabungkan apa pun', async () => {
    await phoneAccount()
    const token = await emailAccount()
    await post('/api/auth/merge/request-otp', { phone: PHONE }, token)

    const wrong = await post('/api/auth/merge/confirm', { phone: PHONE, code: '000000' }, token)
    expect(wrong.status).toBe(422)
    // Akun sumber masih ada — tidak ada yang digabungkan tanpa bukti.
    const lagi = await post('/api/auth/merge/request-otp', { phone: PHONE }, token)
    expect(lagi.status).toBe(429)
  })
})

describe('menunjukkan apa yang akan pindah sebelum diputuskan', () => {
  it('menyertakan ringkasan isi akun sumber', async () => {
    const sumber = await phoneAccount()
    await post('/api/me/points', { delta: 750 }, sumber)

    const token = await emailAccount()
    const requested = await post('/api/auth/merge/request-otp', { phone: PHONE }, token)

    expect(requested.status).toBe(200)
    // Penggabungan tidak bisa dibatalkan, jadi angkanya ditunjukkan lebih dulu.
    expect((requested.body.preview as Body).points).toBe(750)
  })
})

describe('yang selamat setelah digabung', () => {
  it('menjumlahkan poin kedua akun, bukan mengambil yang terbesar', async () => {
    const sumber = await phoneAccount()
    await post('/api/me/points', { delta: 750 }, sumber)

    const token = await emailAccount()
    await post('/api/me/points', { delta: 200 }, token)

    const merged = await merge(token)
    expect(merged.status).toBe(200)
    /*
     * Keduanya dikumpulkan orang yang sama; membuang salah satunya berarti
     * menghanguskan belanja yang benar-benar terjadi.
     */
    expect(Number((await get('/api/me', token)).body.points)).toBe(950)
  })

  it('memindahkan nomor HP sehingga bisa dipakai masuk ke akun gabungan', async () => {
    await phoneAccount()
    const token = await emailAccount()

    const merged = await merge(token)
    expect((merged.body.user as Body).phone).toBe('+628128845150')
    expect(merged.body.methods).toEqual(['phone', 'email'])
  })

  it('memindahkan aduan dan tim milik akun sumber', async () => {
    const sumber = await phoneAccount()
    await post(
      '/api/complaints',
      {
        category: 'lapangan',
        subject: 'Lampu mati di Lap. 2',
        body: 'Dua lampu sisi utara mati sejak kemarin sore.',
        relatedKind: null,
        relatedId: null,
      },
      sumber,
    )
    const tim = await post(
      '/api/teams',
      { name: 'Tim Lama', sport: 'tennis', city: 'Bandung', about: '' },
      sumber,
    )

    const token = await emailAccount()
    const sebelum = (await get('/api/complaints', token)).list.length

    await merge(token)

    expect((await get('/api/complaints', token)).list.length).toBeGreaterThan(sebelum)
    expect((await get('/api/memberships', token)).body.teams).toContain(tim.body.id)
    // Tim yang dibuat akun sumber ikut berpindah pemilik.
    expect((await get(`/api/teams/${tim.body.id}`, token)).body.ownerId).toBeTruthy()
  })

  it('menghapus akun sumber beserta sesinya', async () => {
    const sumber = await phoneAccount()
    const token = await emailAccount()

    await merge(token)

    /*
     * Perangkat yang masih memegang sesi lama harus masuk lagi, bukan
     * menemui akun yang sudah tidak ada.
     */
    expect((await get('/api/auth/me', sumber)).status).toBe(401)
  })
})

describe('yang sengaja dibuang', () => {
  it('membuang pendaftaran turnamen yang kembar, bukan menjadikannya dua kursi', async () => {
    const sumber = await phoneAccount()
    const token = await emailAccount()

    const turnamen = (await get('/api/tournaments', token)).list.find(
      (t) => t.status === 'pendaftaran',
    )!
    await post(`/api/tournaments/${turnamen.id}/register`, { method: 'qris' }, sumber)
    await post(`/api/tournaments/${turnamen.id}/register`, { method: 'qris' }, token)

    const merged = await merge(token)
    const skipped = (merged.body.merged as Body).skipped as Record<string, number>

    expect(skipped.registrations).toBe(1)
    // Satu orang, satu kursi.
    expect((await get('/api/tournaments/registrations', token)).list).toHaveLength(1)
  })

  it('melepas kontak yang slotnya sudah terisi, dan melaporkannya', async () => {
    const sumber = await phoneAccount()
    // Akun sumber punya nomor DAN email.
    await post('/api/auth/link/email', { email: 'lama@dbtc.test', password: PASSWORD }, sumber)

    const token = await emailAccount()
    const merged = await merge(token)

    const contacts = (merged.body.merged as Body).contacts as {
      moved: string[]
      released: string[]
    }
    expect(contacts.moved).toContain('phone')
    /*
     * Slot email akun tujuan sudah terisi, jadi email akun sumber dilepas —
     * bukan menimpa diam-diam.
     */
    expect(contacts.released).toContain('email')
    const coba = await post('/api/auth/email/login', {
      email: 'lama@dbtc.test',
      password: PASSWORD,
    })
    expect(coba.status).toBe(401)
  })
})

describe('setelah slot dikosongkan, penggabungan jalan', () => {
  it('menerima penggabungan begitu nomor lama dilepas', async () => {
    await phoneAccount()
    const token = await phoneAccount('08128845151', 'Punya Nomor')
    // Perlu cara masuk kedua sebelum nomornya boleh dilepas.
    await post('/api/auth/link/email', { email: 'kedua@dbtc.test', password: PASSWORD }, token)

    expect((await post('/api/auth/merge/request-otp', { phone: PHONE }, token)).status).toBe(409)

    await del('/api/auth/link/phone', token)
    const merged = await merge(token)
    expect(merged.status).toBe(200)
    expect((merged.body.user as Body).phone).toBe('+628128845150')
  })
})

describe('akun tujuan yang profilnya belum pernah dibuka', () => {
  it('tidak menghanguskan poin akun sumber', async () => {
    const sumber = await phoneAccount()
    await post('/api/me/points', { delta: 1250 }, sumber)

    /*
     * Akun tujuan sengaja **tidak** menyentuh /api/me sama sekali, jadi baris
     * profilnya belum ada. Ini yang dulu membuat poin lenyap: UPDATE ke baris
     * yang tidak ada mengenai nol baris, lalu baris sumber dihapus.
     */
    const token = await emailAccount()
    const merged = await merge(token)

    expect(merged.status).toBe(200)
    expect(Number((await get('/api/me', token)).body.points)).toBe(1250)
  })

  it('membawa serta status keanggotaan dan tanggal gabung', async () => {
    const sumber = await phoneAccount()
    const sebelum = (await get('/api/me', sumber)).body.joinedAt

    const token = await emailAccount()
    await merge(token)

    expect((await get('/api/me', token)).body.joinedAt).toBe(sebelum)
  })
})
