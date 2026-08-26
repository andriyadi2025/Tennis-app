/**
 * localStorage bernamespace. Semua kunci diawali `lapangin:` dan `clearAll()`
 * hanya menghapus kunci berprefiks itu — kunci milik aplikasi lain di origin
 * yang sama tidak pernah disentuh.
 */
const NAMESPACE = 'lapangin:'

function key(name: string): string {
  return `${NAMESPACE}${name}`
}

function available(): boolean {
  try {
    const probe = `${NAMESPACE}__probe`
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return true
  } catch {
    // Private mode / storage diblokir — aplikasi tetap jalan tanpa persistensi.
    return false
  }
}

export function readJson<T>(name: string, fallback: T): T {
  if (!available()) return fallback
  try {
    const raw = window.localStorage.getItem(key(name))
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJson(name: string, value: unknown): void {
  if (!available()) return
  try {
    window.localStorage.setItem(key(name), JSON.stringify(value))
  } catch {
    // Kuota penuh — abaikan, state in-memory tetap benar.
  }
}

export function remove(name: string): void {
  if (!available()) return
  try {
    window.localStorage.removeItem(key(name))
  } catch {
    /* noop */
  }
}

/** Hanya menghapus kunci yang ditulis aplikasi ini. */
export function clearAll(): void {
  if (!available()) return
  try {
    const ours: string[] = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith(NAMESPACE)) ours.push(k)
    }
    ours.forEach((k) => window.localStorage.removeItem(k))
  } catch {
    /* noop */
  }
}

export const STORAGE_KEYS = {
  auth: 'auth',
  draft: 'booking-draft',
} as const
