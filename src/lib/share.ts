export type ShareOutcome = 'shared' | 'copied' | 'unsupported'

export interface SharePayload {
  title: string
  text: string
  url: string
}

/**
 * Web Share API kalau ada, salin ke papan klip kalau tidak. Keduanya
 * mengembalikan hasil yang berbeda supaya UI bisa bilang hal yang benar —
 * "Tersalin" setelah share sheet muncul akan membingungkan.
 *
 * Batal berbagi (user menutup share sheet) melempar AbortError dan itu bukan
 * kegagalan: diperlakukan sebagai tidak terjadi apa-apa, bukan error.
 */
export async function share(payload: SharePayload): Promise<ShareOutcome> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share(payload)
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'unsupported'
      // Share gagal karena alasan lain — jatuh ke papan klip.
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(`${payload.text}\n${payload.url}`)
      return 'copied'
    } catch {
      return 'unsupported'
    }
  }

  return 'unsupported'
}
