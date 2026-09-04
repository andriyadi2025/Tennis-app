import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { createApp } from '../src/app.ts'
import { resetDatabase } from '../src/db.ts'
import { seedDomain } from '../src/domain/store.ts'
import { truncateDomain } from '../src/domain/schema.ts'
import { db } from '../src/db.ts'

/**
 * Domain lewat HTTP sungguhan ke app yang sama dengan yang dijalankan
 * produksi.
 *
 * Yang paling banyak diuji di sini bukan perhitungannya — itu sudah diuji
 * sebagai fungsi murni di `shared/` — melainkan **kepemilikan**. Selama
 * domain dilayani MSW di dalam browser, hanya ada satu orang, jadi "booking
 * siapa ini" tidak pernah jadi pertanyaan yang bisa salah dijawab.
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
const patch = (p: string, b: unknown, t?: string) => send('PATCH', p, b, t)

/** Membuat akun lewat OTP dan mengembalikan tokennya. */
async function signIn(phone: string, name: string): Promise<string> {
  const requested = await post('/api/auth/phone/request-otp', { phone })
  const verified = await post('/api/auth/phone/verify-otp', {
    phone,
    code: requested.body.devCode as string,
    name,
  })
  return verified.body.token as string
}

const RAKA = '08128845101'
const DIMAS = '08128845102'

describe('gerbang sesi', () => {
  it('menolak setiap endpoint domain tanpa token', async () => {
    for (const path of [
      '/api/me',
      '/api/venues',
      '/api/bookings',
      '/api/merch',
      '/api/complaints',
    ]) {
      expect((await get(path)).status).toBe(401)
    }
  })
})

describe('profil', () => {
  it('membuat profil main saat pertama dibuka, bukan saat mendaftar', async () => {
    const token = await signIn(RAKA, 'Raka')
    const me = await get('/api/me', token)
    expect(me.status).toBe(200)
    // Server auth tidak tahu apa-apa soal poin; profil lahir di sini.
    expect(me.body.points).toBe(0)
    expect(me.body.tier).toBe('Rookie')
  })

  it('memberi tiap orang profil sendiri', async () => {
    const raka = await signIn(RAKA, 'Raka')
    const dimas = await signIn(DIMAS, 'Dimas')

    await post('/api/me/points', { delta: 500 }, raka)

    expect((await get('/api/me', raka)).body.points).toBe(500)
    expect((await get('/api/me', dimas)).body.points).toBe(0)
  })
})

describe('booking', () => {
  async function firstCourt(token: string) {
    const venues = await get('/api/venues', token)
    const venue = venues.list[0] as unknown as { id: string; courts: { id: string }[] }
    return { venueId: venue.id, courtId: venue.courts[0]!.id }
  }

  /** Jam kosong berikutnya di lapangan itu, diambil dari grid server. */
  async function freeSlot(token: string, venueId: string, courtId: string) {
    const besok = new Date()
    besok.setDate(besok.getDate() + 2)
    const slots = await get(
      `/api/venues/${venueId}/slots?courtId=${courtId}&date=${besok.toISOString()}`,
      token,
    )
    const open = slots.list.find((s) => s.status === 'available')
    return String(open!.startsAt)
  }

  it('menghitung harga di server, bukan menerima angka dari klien', async () => {
    const token = await signIn(RAKA, 'Raka')
    const { venueId, courtId } = await firstCourt(token)
    const startsAt = await freeSlot(token, venueId, courtId)

    const created = await post(
      '/api/bookings',
      {
        venueId,
        courtId,
        startsAt: [startsAt],
        recurrenceWeeks: 1,
        addOnIds: [],
        pointsRedeemed: 0,
      },
      token,
    )
    expect(created.status).toBe(201)
    expect(Number(created.body.totalIdr)).toBeGreaterThan(0)
    expect(created.body.status).toBe('awaitingPayment')
  })

  it('membatasi penukaran poin ke saldo sungguhan, bukan angka kiriman', async () => {
    const token = await signIn(RAKA, 'Raka')
    const { venueId, courtId } = await firstCourt(token)
    const startsAt = await freeSlot(token, venueId, courtId)

    const created = await post(
      '/api/bookings',
      {
        venueId,
        courtId,
        startsAt: [startsAt],
        recurrenceWeeks: 1,
        addOnIds: [],
        // Saldonya nol; mempercayai angka ini berarti memberi potongan yang
        // tidak dibayar poin siapa pun.
        pointsRedeemed: 100_000,
      },
      token,
    )
    expect(created.body.pointsRedeemed).toBe(0)
    expect(created.body.discountIdr).toBe(0)
  })

  it('mengunci slot setelah dibayar, dan menolak orang kedua di jam yang sama', async () => {
    const raka = await signIn(RAKA, 'Raka')
    const dimas = await signIn(DIMAS, 'Dimas')
    const { venueId, courtId } = await firstCourt(raka)
    const startsAt = await freeSlot(raka, venueId, courtId)

    const first = await post(
      '/api/bookings',
      {
        venueId,
        courtId,
        startsAt: [startsAt],
        recurrenceWeeks: 1,
        addOnIds: [],
        pointsRedeemed: 0,
      },
      raka,
    )
    const paid = await post(`/api/bookings/${first.body.id}/pay`, { method: 'qris' }, raka)
    expect(paid.status).toBe(200)
    expect(paid.body.status).toBe('confirmed')

    // Orang lain, jam yang sama: inilah yang tidak pernah bisa terjadi
    // selama domainnya hidup di dalam browser satu orang.
    const clash = await post(
      '/api/bookings',
      {
        venueId,
        courtId,
        startsAt: [startsAt],
        recurrenceWeeks: 1,
        addOnIds: [],
        pointsRedeemed: 0,
      },
      dimas,
    )
    expect(clash.status).toBe(409)
    expect(clash.body.code).toBe('SLOT_TAKEN')
  })

  it('tidak membocorkan booking orang lain', async () => {
    const raka = await signIn(RAKA, 'Raka')
    const dimas = await signIn(DIMAS, 'Dimas')
    const { venueId, courtId } = await firstCourt(raka)
    const startsAt = await freeSlot(raka, venueId, courtId)

    const created = await post(
      '/api/bookings',
      {
        venueId,
        courtId,
        startsAt: [startsAt],
        recurrenceWeeks: 1,
        addOnIds: [],
        pointsRedeemed: 0,
      },
      raka,
    )

    expect((await get('/api/bookings', dimas)).list).toHaveLength(0)
    expect((await get(`/api/bookings/${created.body.id}`, dimas)).status).toBe(404)
  })

  it('memberi poin belanja saat dibayar, bukan saat ringkasan dibuat', async () => {
    const token = await signIn(RAKA, 'Raka')
    const { venueId, courtId } = await firstCourt(token)
    const startsAt = await freeSlot(token, venueId, courtId)

    const created = await post(
      '/api/bookings',
      {
        venueId,
        courtId,
        startsAt: [startsAt],
        recurrenceWeeks: 1,
        addOnIds: [],
        pointsRedeemed: 0,
      },
      token,
    )
    // Booking yang tidak jadi tidak boleh menghasilkan poin.
    expect((await get('/api/me', token)).body.points).toBe(0)

    await post(`/api/bookings/${created.body.id}/pay`, { method: 'qris' }, token)
    expect(Number((await get('/api/me', token)).body.points)).toBeGreaterThan(0)
  })
})

describe('toko', () => {
  async function pointsFor(token: string, amount: number) {
    await post('/api/me/points', { delta: amount }, token)
  }

  it('memotong stok bersama dan poin milik pemesan', async () => {
    const raka = await signIn(RAKA, 'Raka')
    const dimas = await signIn(DIMAS, 'Dimas')
    await pointsFor(raka, 5_000)

    const before = await get('/api/merch/m-tumbler', raka)
    const stokAwal = (before.body.variants as { stock: number }[])[0]!.stock

    const order = await post(
      '/api/merch/m-tumbler/order',
      { variantId: 'm-tumbler-1', qty: 2, payMode: 'poin' },
      raka,
    )
    expect(order.status).toBe(201)

    // Stok itu milik klub — orang lain melihat pengurangannya.
    const after = await get('/api/merch/m-tumbler', dimas)
    expect((after.body.variants as { stock: number }[])[0]!.stock).toBe(stokAwal - 2)

    // Poin itu milik pemesannya saja.
    expect(Number((await get('/api/me', raka)).body.points)).toBe(5_000 - 1_800)
    expect(Number((await get('/api/me', dimas)).body.points)).toBe(0)
  })

  it('menolak pesanan yang poinnya kurang, dengan menyebut kekurangannya', async () => {
    const token = await signIn(RAKA, 'Raka')
    const blocked = await post(
      '/api/merch/m-tumbler/order',
      { variantId: 'm-tumbler-1', qty: 1, payMode: 'poin' },
      token,
    )
    expect(blocked.status).toBe(409)
    expect(String(blocked.body.message)).toMatch(/Poin kamu kurang/)
  })

  it('mengembalikan stok dan poin saat dibatalkan', async () => {
    const token = await signIn(RAKA, 'Raka')
    await pointsFor(token, 5_000)

    const order = await post(
      '/api/merch/m-tumbler/order',
      { variantId: 'm-tumbler-1', qty: 2, payMode: 'poin' },
      token,
    )
    await post(`/api/merch-orders/${order.body.id}/cancel`, {}, token)

    expect(Number((await get('/api/me', token)).body.points)).toBe(5_000)
    const item = await get('/api/merch/m-tumbler', token)
    expect((item.body.variants as { stock: number }[])[0]!.stock).toBe(12)
  })

  it('tidak membiarkan orang lain membatalkan pesanan yang bukan miliknya', async () => {
    const raka = await signIn(RAKA, 'Raka')
    const dimas = await signIn(DIMAS, 'Dimas')
    await pointsFor(raka, 5_000)

    const order = await post(
      '/api/merch/m-tumbler/order',
      { variantId: 'm-tumbler-1', qty: 1, payMode: 'poin' },
      raka,
    )
    expect((await post(`/api/merch-orders/${order.body.id}/cancel`, {}, dimas)).status).toBe(404)
  })
})

describe('aduan', () => {
  it('hanya menampilkan aduan sendiri kepada anggota biasa', async () => {
    const raka = await signIn(RAKA, 'Raka')
    const dimas = await signIn(DIMAS, 'Dimas')

    await post(
      '/api/complaints',
      {
        category: 'lapangan',
        subject: 'Lampu mati',
        body: 'Dua lampu di sisi utara mati sejak kemarin sore.',
        relatedKind: null,
        relatedId: null,
      },
      raka,
    )

    const punyaRaka = await get('/api/complaints', raka)
    const punyaDimas = await get('/api/complaints', dimas)
    // Masing-masing dapat satu aduan contoh saat profilnya dibuat, plus
    // yang baru untuk Raka.
    expect(punyaRaka.list.length).toBe(punyaDimas.list.length + 1)
    expect(punyaDimas.list.every((c) => c.userName === 'Dimas')).toBe(true)
  })

  it('menolak membuka aduan milik orang lain', async () => {
    const raka = await signIn(RAKA, 'Raka')
    const dimas = await signIn(DIMAS, 'Dimas')
    const created = await post(
      '/api/complaints',
      {
        category: 'lapangan',
        subject: 'Lampu mati',
        body: 'Dua lampu di sisi utara mati sejak kemarin sore.',
        relatedKind: null,
        relatedId: null,
      },
      raka,
    )
    expect((await get(`/api/complaints/${created.body.id}`, dimas)).status).toBe(403)
  })

  it('menolak mengubah status kalau bukan admin', async () => {
    const raka = await signIn(RAKA, 'Raka')
    const created = await post(
      '/api/complaints',
      {
        category: 'lapangan',
        subject: 'Lampu mati',
        body: 'Dua lampu di sisi utara mati sejak kemarin sore.',
        relatedKind: null,
        relatedId: null,
      },
      raka,
    )
    const denied = await patch(
      `/api/complaints/${created.body.id}/status`,
      { status: 'selesai' },
      raka,
    )
    expect(denied.status).toBe(403)
  })
})

describe('dasbor admin', () => {
  it('menolak anggota biasa di seluruh endpoint admin', async () => {
    const token = await signIn(RAKA, 'Raka')
    for (const path of ['/api/admin/settings', '/api/admin/courts', '/api/admin/merch']) {
      expect((await get(path, token)).status).toBe(403)
    }
  })
})

describe('open match', () => {
  it('mencatat siapa yang benar-benar bergabung', async () => {
    const raka = await signIn(RAKA, 'Raka')
    const dimas = await signIn(DIMAS, 'Dimas')

    const matches = await get('/api/open-matches', raka)
    const id = String(matches.list[0]!.id)

    await post(`/api/open-matches/${id}/join`, {}, raka)

    const mine = await get('/api/memberships', raka)
    const theirs = await get('/api/memberships', dimas)
    expect(mine.body.openMatches).toContain(id)
    expect(theirs.body.openMatches).not.toContain(id)
  })

  it('tidak menambah pemain dua kali kalau bergabung berulang', async () => {
    const token = await signIn(RAKA, 'Raka')
    const matches = await get('/api/open-matches', token)
    const id = String(matches.list[0]!.id)

    const first = await post(`/api/open-matches/${id}/join`, {}, token)
    const before = (first.body.players as unknown[]).length
    const second = await post(`/api/open-matches/${id}/join`, {}, token)
    expect((second.body.players as unknown[]).length).toBe(before)
  })
})

describe('negosiasi waktu sparring', () => {
  async function anInvite(token: string) {
    const rows = await get('/api/sparring', token)
    const masuk = rows.list.find((r) => r.direction === 'masuk')
    return masuk as unknown as { id: string; proposedAt: string | null }
  }

  const besok = (days: number, hour: number) => {
    const d = new Date()
    d.setDate(d.getDate() + days)
    d.setHours(hour, 0, 0, 0)
    return d.toISOString()
  }

  it('mencatat usulan dan memindahkan waktu ajakan ke usulan terbaru', async () => {
    const token = await signIn(RAKA, 'Raka')
    const invite = await anInvite(token)

    const proposed = await post(
      `/api/sparring/${invite.id}/propose`,
      { proposedAt: besok(3, 19), venueName: 'GOR Cendana' },
      token,
    )
    expect(proposed.status).toBe(201)
    const after = proposed.body.invite as Record<string, unknown>
    expect(after.proposedAt).toBe(besok(3, 19))
    expect(after.venueName).toBe('GOR Cendana')
  })

  it('menandai usulan lama "diganti", bukan menghapusnya', async () => {
    const token = await signIn(RAKA, 'Raka')
    const invite = await anInvite(token)

    await post(`/api/sparring/${invite.id}/propose`, { proposedAt: besok(3, 19) }, token)
    await post(`/api/sparring/${invite.id}/propose`, { proposedAt: besok(5, 20) }, token)

    const rows = await get(`/api/sparring/${invite.id}/proposals`, token)
    const statuses = rows.list.map((r) => r.status)
    // Riwayatnya yang menjelaskan bagaimana kedua tim sampai pada jam ini.
    expect(statuses).toContain('diganti')
    expect(statuses.filter((s) => s === 'menunggu')).toHaveLength(1)
  })

  it('membuka kembali ajakan yang sudah diterima kalau waktunya diusulkan ulang', async () => {
    const token = await signIn(RAKA, 'Raka')
    const invite = await anInvite(token)

    await post(`/api/sparring/${invite.id}/propose`, { proposedAt: besok(3, 19) }, token)
    const accepted = await post(`/api/sparring/${invite.id}/respond`, { accept: true }, token)
    expect(accepted.body.status).toBe('diterima')

    // Waktu yang berubah berarti kesepakatannya berubah.
    const again = await post(
      `/api/sparring/${invite.id}/propose`,
      { proposedAt: besok(6, 20) },
      token,
    )
    expect((again.body.invite as Record<string, unknown>).status).toBe('menunggu')
  })

  it('menolak usulan waktu yang sudah lewat', async () => {
    const token = await signIn(RAKA, 'Raka')
    const invite = await anInvite(token)
    const kemarin = new Date(Date.now() - 86_400_000).toISOString()

    const rejected = await post(
      `/api/sparring/${invite.id}/propose`,
      { proposedAt: kemarin },
      token,
    )
    expect(rejected.status).toBe(422)
    expect(rejected.body.code).toBe('PAST_TIME')
  })

  it('menolak menerima ajakan yang belum punya usulan waktu', async () => {
    const token = await signIn(RAKA, 'Raka')
    const rows = await get('/api/sparring', token)
    const tanpaWaktu = rows.list.find((r) => r.direction === 'masuk' && r.proposedAt === null)
    if (!tanpaWaktu) return // seed tidak selalu punya kasus ini

    const rejected = await post(`/api/sparring/${tanpaWaktu.id}/respond`, { accept: true }, token)
    // Menyetujui ruang kosong tidak menghasilkan apa pun yang bisa dicatat.
    expect(rejected.status).toBe(409)
    expect(rejected.body.code).toBe('NO_TIME_PROPOSED')
  })

  it('menandai usulan terakhir "diterima" saat ajakan disetujui', async () => {
    const token = await signIn(RAKA, 'Raka')
    const invite = await anInvite(token)

    await post(`/api/sparring/${invite.id}/propose`, { proposedAt: besok(3, 19) }, token)
    await post(`/api/sparring/${invite.id}/respond`, { accept: true }, token)

    const rows = await get(`/api/sparring/${invite.id}/proposals`, token)
    expect(rows.list.at(-1)!.status).toBe('diterima')
  })
})

describe('realtime', () => {
  /** Membaca satu event dari aliran SSE, dengan batas waktu. */
  async function firstEvent(path: string, token: string, timeoutMs = 4_000): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const response = await fetch(`${base}${path}?token=${encodeURIComponent(token)}`, {
      signal: controller.signal,
    })
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (buffer.split('\n\n').length < 3) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        if (buffer.includes('event:')) break
      }
    } catch {
      /*
       * Batas waktu habis tanpa event. Itu kegagalan untuk satu kasus dan
       * justru hasil yang diharapkan untuk kasus lain, jadi yang dikembalikan
       * adalah apa yang sempat terbaca — bukan lemparan yang memaksa kedua
       * kasus ditulis dengan cara berbeda.
       */
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
    return buffer
  }

  it('memberi tahu pendengar saat orang lain mengirim pesan', async () => {
    const raka = await signIn(RAKA, 'Raka')
    const dimas = await signIn(DIMAS, 'Dimas')

    const matches = await get('/api/open-matches', raka)
    const chatId = String(matches.list[0]!.chatId)

    const listening = firstEvent(`/api/chats/${chatId}/stream`, raka)
    // Beri kesempatan aliran tersambung sebelum pesannya dikirim.
    await new Promise((r) => setTimeout(r, 300))
    await post(`/api/chats/${chatId}/messages`, { body: 'Halo dari Dimas' }, dimas)

    const received = await listening
    expect(received).toContain('event: message')
  })

  it('tidak memberi tahu pengirimnya sendiri', async () => {
    const raka = await signIn(RAKA, 'Raka')
    const matches = await get('/api/open-matches', raka)
    const chatId = String(matches.list[0]!.chatId)

    const listening = firstEvent(`/api/chats/${chatId}/stream`, raka, 1_500)
    await new Promise((r) => setTimeout(r, 300))
    // Ia sudah punya hasilnya dari balasan HTTP-nya sendiri.
    await post(`/api/chats/${chatId}/messages`, { body: 'Pesan sendiri' }, raka)

    const received = await listening
    expect(received).not.toContain('event: message')
  })

  it('menolak aliran tanpa token', async () => {
    const response = await fetch(`${base}/api/chats/chat-om-1/stream`)
    expect(response.status).toBe(401)
  })
})
