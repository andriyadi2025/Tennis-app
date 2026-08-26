/**
 * localStorage bernamespace. Semua kunci diawali `dbtc:` dan `clearAll()`
 * hanya menghapus kunci berprefiks itu — kunci milik aplikasi lain di origin
 * yang sama tidak pernah disentuh.
 */
const NAMESPACE = 'dbtc:'

/** Prefiks lama sebelum app berganti merek dari Lapangin ke DBTC. */
const LEGACY_NAMESPACE = 'lapangin:'

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

/**
 * Memindahkan kunci berprefiks lama ke prefiks baru, sekali saja saat app
 * pertama dimuat setelah ganti merek. Tanpa ini, booking dan preferensi yang
 * sudah tersimpan akan tampak hilang begitu namanya berubah — padahal datanya
 * masih ada, hanya namanya yang tidak lagi dicari.
 */
function migrateLegacyKeys(): void {
  if (!available()) return
  try {
    const legacy: string[] = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith(LEGACY_NAMESPACE)) legacy.push(k)
    }
    legacy.forEach((oldKey) => {
      const newKey = `${NAMESPACE}${oldKey.slice(LEGACY_NAMESPACE.length)}`
      // Kunci baru yang sudah ada menang — jangan menimpa data yang lebih baru.
      if (window.localStorage.getItem(newKey) === null) {
        const value = window.localStorage.getItem(oldKey)
        if (value !== null) window.localStorage.setItem(newKey, value)
      }
      window.localStorage.removeItem(oldKey)
    })
  } catch {
    // Migrasi gagal bukan alasan app tidak boleh jalan.
  }
}

migrateLegacyKeys()

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
