import { createStore, truncateAll, type Sql } from './store/index.ts'

/**
 * Koneksi basis data untuk seluruh server.
 *
 * Dulu berisi `DatabaseSync` langsung dari `node:sqlite`. Sekarang ia hanya
 * memilih driver lewat `store/`, karena SQLite tidak bisa dibagi antar
 * instance — dan yang membuat perpindahan ke Postgres mungkin bukan
 * "SQL-nya standar", melainkan tidak adanya kode lain yang menyentuh driver.
 *
 * Top-level await dipakai supaya pemanggil tetap sesederhana dulu:
 * `import { db }` dan langsung pakai, tanpa langkah inisialisasi terpisah
 * yang bisa terlupa di satu tempat.
 */
export const db: Sql = await createStore()

export interface UserRow {
  id: string
  name: string
  phone: string | null
  phone_verified: number
  email: string | null
  email_verified: number
  password_hash: string | null
  role: string
  created_at: string
}

/** Membuang baris kedaluwarsa. Dipanggil berkala, bukan tiap permintaan. */
export async function purgeExpired(now: Date = new Date()): Promise<void> {
  const iso = now.toISOString()
  await db.run('DELETE FROM sessions WHERE expires_at < ?', [iso])
  await db.run('DELETE FROM otp_codes WHERE expires_at < ?', [iso])
  await db.run('DELETE FROM email_tokens WHERE expires_at < ?', [iso])
  await db.run('DELETE FROM oauth_states WHERE expires_at < ?', [iso])
}

/** Hanya untuk tes: mengosongkan seluruh tabel. */
export async function resetDatabase(): Promise<void> {
  await truncateAll(db)
}
