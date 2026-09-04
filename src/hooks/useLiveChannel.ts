import { useEffect } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { STORAGE_KEYS, readJson } from '@/lib/storage'

/**
 * Mendengarkan perubahan satu kanal lewat Server-Sent Events.
 *
 * Yang datang lewat aliran ini cuma kabar "ada yang berubah" — isinya tetap
 * diambil lewat endpoint biasa. Dua alasan: tidak ada dua jalur data yang
 * bisa menyimpang, dan pesan yang terlewat saat koneksi putus tetap ikut
 * terbaca pada pengambilan berikutnya. Menaruh isi pesan di dalam event
 * berarti kehilangan koneksi sama dengan kehilangan pesan.
 *
 * `EventSource` tidak bisa memasang header, jadi tokennya lewat query string.
 * Itu aman di sini karena token hanya menyeberang ke server sendiri lewat
 * origin yang sama — tapi ia bisa muncul di log akses server, jadi jangan
 * dipakai untuk sesuatu yang lebih rahasia dari sesi ini.
 */
export function useLiveChannel(
  path: string | null,
  keysToInvalidate: QueryKey[],
  enabled = true,
): void {
  const client = useQueryClient()

  useEffect(() => {
    if (!path || !enabled) return
    // Peramban lama tanpa EventSource tetap jalan, cuma tidak realtime —
    // datanya sudah diambil lewat query biasa.
    if (typeof EventSource === 'undefined') return

    const token = readJson<{ token: string | null }>(STORAGE_KEYS.auth, { token: null }).token
    if (!token) return

    const source = new EventSource(`${path}?token=${encodeURIComponent(token)}`)

    const refresh = () => {
      for (const key of keysToInvalidate) {
        void client.invalidateQueries({ queryKey: key })
      }
    }

    for (const event of ['message', 'status', 'proposal']) {
      source.addEventListener(event, refresh)
    }

    /*
     * Error tidak menutup koneksi: EventSource menyambung ulang sendiri, dan
     * menutupnya di sini berarti kehilangan realtime setiap kali jaringan
     * berkedip sekali.
     */
    return () => source.close()
    // `keysToInvalidate` sengaja tidak jadi dependensi: pemanggil membuatnya
    // inline, jadi ia beda referensi tiap render dan akan menyambung ulang
    // aliran ini terus-menerus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled, client])
}
