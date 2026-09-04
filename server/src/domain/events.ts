import type { Response } from 'express'

/**
 * Realtime lewat Server-Sent Events.
 *
 * SSE, bukan WebSocket: yang dibutuhkan cuma satu arah — server memberi tahu
 * klien bahwa ada yang berubah. SSE jalan di atas HTTP biasa, lewat proxy
 * yang sama, tanpa protokol kedua yang perlu diamankan sendiri, dan browser
 * menyambung ulang otomatis kalau koneksinya putus.
 *
 * Yang sengaja **tidak** dilakukan: menaruh isi pesan di dalam event sebagai
 * satu-satunya sumber. Event hanya berkata "utas ini berubah"; klien lalu
 * mengambil isinya lewat endpoint biasa. Dengan begitu tidak ada dua jalur
 * yang bisa menyimpang, dan pesan yang terlewat saat koneksi putus tetap
 * ikut terbaca pada pengambilan berikutnya.
 */

export type ChannelKind = 'chat' | 'sparring' | 'complaint'

interface Subscriber {
  id: number
  userId: string
  res: Response
}

const channels = new Map<string, Set<Subscriber>>()
let nextId = 1

function key(kind: ChannelKind, id: string): string {
  return `${kind}:${id}`
}

/**
 * Menyambungkan satu klien ke sebuah kanal. Mengembalikan fungsi pemutus
 * yang wajib dipanggil saat koneksi tutup — pendengar yang tidak dilepas
 * adalah kebocoran memori yang tumbuh sepanjang server hidup.
 */
export function subscribe(
  kind: ChannelKind,
  id: string,
  userId: string,
  res: Response,
): () => void {
  const name = key(kind, id)
  const subscriber: Subscriber = { id: nextId++, userId, res }

  let set = channels.get(name)
  if (!set) {
    set = new Set()
    channels.set(name, set)
  }
  set.add(subscriber)

  return () => {
    const current = channels.get(name)
    if (!current) return
    current.delete(subscriber)
    if (current.size === 0) channels.delete(name)
  }
}

/**
 * Memberi tahu semua yang mendengarkan kanal ini.
 *
 * `exceptUserId` melewati pengirimnya sendiri: ia sudah punya hasilnya dari
 * balasan HTTP-nya, dan memberitahunya lagi hanya memicu pengambilan ulang
 * yang tidak menambah apa pun.
 */
export function publish(
  kind: ChannelKind,
  id: string,
  event: string,
  data: Record<string, unknown> = {},
  exceptUserId?: string,
): void {
  const set = channels.get(key(kind, id))
  if (!set) return

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const subscriber of set) {
    if (exceptUserId && subscriber.userId === exceptUserId) continue
    try {
      subscriber.res.write(payload)
    } catch {
      // Koneksi yang sudah mati akan dibersihkan oleh handler 'close'-nya
      // sendiri; menulis ke sana tidak boleh menjatuhkan pengiriman ke yang lain.
    }
  }
}

/** Jumlah pendengar — dipakai tes dan endpoint diagnostik. */
export function subscriberCount(kind: ChannelKind, id: string): number {
  return channels.get(key(kind, id))?.size ?? 0
}

/**
 * Menyiapkan respons SSE. Header dikirim segera supaya browser tahu koneksi
 * ini terbuka; tanpa flush awal, sebagian proxy menahan seluruh respons
 * sampai byte pertama datang — yang bisa berarti tidak pernah.
 */
export function openStream(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Nginx menahan buffer respons streaming tanpa header ini.
    'X-Accel-Buffering': 'no',
  })
  res.write('retry: 3000\n\n')
}

/**
 * Denyut berkala. Proxy dan load balancer memutus koneksi yang diam terlalu
 * lama, dan putusnya tidak terlihat dari sisi server sampai ada yang mencoba
 * menulis — jadi lebih baik menulis sesuatu secara berkala.
 */
export function heartbeat(res: Response, ms = 25_000): () => void {
  const timer = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      clearInterval(timer)
    }
  }, ms)
  timer.unref?.()
  return () => clearInterval(timer)
}
