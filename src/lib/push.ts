import { STORAGE_KEYS, readJson } from './storage'

/**
 * Berlangganan notifikasi push dari sisi peramban.
 *
 * Tiga hal harus ada dan tidak satu pun bisa diasumsikan: service worker,
 * Push API, dan izin dari orangnya. Masing-masing punya alasan sendiri untuk
 * tidak tersedia — peramban lama, mode penyamaran, izin yang sudah ditolak
 * permanen — dan tiap keadaan dikembalikan apa adanya supaya layar bisa
 * mengatakannya, bukan menampilkan tombol yang tidak akan bekerja.
 */

export type PushState =
  'unsupported' | 'unconfigured' | 'denied' | 'prompt' | 'subscribed' | 'error'

export interface PushStatus {
  state: PushState
  /** Endpoint langganan yang sedang aktif, kalau ada. */
  endpoint: string | null
  message?: string
}

function token(): string | null {
  return readJson<{ token: string | null }>(STORAGE_KEYS.auth, { token: null }).token
}

export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/**
 * Kunci VAPID datang sebagai base64url; Push API menuntut byte.
 *
 * Buffer-nya dibuat eksplisit sebagai `ArrayBuffer`, bukan dibiarkan
 * `ArrayBufferLike`: tipe bawaan Push API menolak Uint8Array yang mungkin
 * bersandar pada SharedArrayBuffer, dan itu memang tidak pernah yang
 * dimaksud di sini.
 */
function decodeKey(base64: string): ArrayBuffer {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes.buffer
}

async function serverKey(): Promise<string | null> {
  const response = await fetch('/api/auth/push/key')
  if (!response.ok) return null
  const body = (await response.json()) as { available: boolean; publicKey: string | null }
  return body.available ? body.publicKey : null
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register('/sw.js', { scope: '/' })
}

export async function pushStatus(): Promise<PushStatus> {
  if (!pushSupported()) {
    return { state: 'unsupported', endpoint: null, message: 'Peramban ini tidak mendukung push.' }
  }
  if (!(await serverKey())) {
    return {
      state: 'unconfigured',
      endpoint: null,
      message: 'Server ini belum dikonfigurasi untuk push.',
    }
  }
  if (Notification.permission === 'denied') {
    return {
      state: 'denied',
      endpoint: null,
      message: 'Izin notifikasi ditolak. Ubah dari setelan situs di peramban.',
    }
  }

  const existing = await (await registration()).pushManager.getSubscription()
  if (existing) return { state: 'subscribed', endpoint: existing.endpoint }
  return { state: 'prompt', endpoint: null }
}

/**
 * Meminta izin lalu mendaftarkan langganan ke server.
 *
 * Izin diminta **saat orangnya menekan tombol**, bukan saat app dibuka.
 * Peramban menghitung penolakan yang diminta tanpa konteks, dan sekali
 * ditolak permanen tidak ada cara memintanya lagi dari dalam app.
 */
export async function subscribePush(): Promise<PushStatus> {
  if (!pushSupported()) return { state: 'unsupported', endpoint: null }

  const key = await serverKey()
  if (!key) return { state: 'unconfigured', endpoint: null }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return {
      state: permission === 'denied' ? 'denied' : 'prompt',
      endpoint: null,
      message: 'Izin notifikasi belum diberikan.',
    }
  }

  try {
    const reg = await registration()
    const subscription =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        // Wajib true di Chrome: langganan tanpa muatan yang terlihat pengguna
        // ditolak, dan itu memang benar — push diam-diam adalah pelacakan.
        userVisibleOnly: true,
        applicationServerKey: decodeKey(key),
      }))

    const json = subscription.toJSON() as { endpoint?: string; keys?: Record<string, string> }
    const response = await fetch('/api/auth/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ endpoint: subscription.endpoint, keys: json.keys }),
    })
    if (!response.ok) {
      return { state: 'error', endpoint: null, message: 'Server menolak langganan ini.' }
    }
    return { state: 'subscribed', endpoint: subscription.endpoint }
  } catch (error) {
    return { state: 'error', endpoint: null, message: (error as Error).message }
  }
}

export async function unsubscribePush(): Promise<PushStatus> {
  if (!pushSupported()) return { state: 'unsupported', endpoint: null }
  const subscription = await (await registration()).pushManager.getSubscription()
  if (!subscription) return { state: 'prompt', endpoint: null }

  // Dilepas di server lebih dulu: kalau urutannya dibalik dan pemutusannya
  // gagal, server tetap mengirim ke langganan yang sudah tidak ada.
  await fetch(`/api/auth/push/subscribe?endpoint=${encodeURIComponent(subscription.endpoint)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token()}` },
  }).catch(() => undefined)
  await subscription.unsubscribe()

  return { state: 'prompt', endpoint: null }
}

export async function sendTestPush(): Promise<{ sent: number; delivered: boolean }> {
  const response = await fetch('/api/auth/push/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: '{}',
  })
  if (!response.ok) return { sent: 0, delivered: false }
  return (await response.json()) as { sent: number; delivered: boolean }
}
