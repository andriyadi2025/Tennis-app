import { DatabaseSync } from 'node:sqlite'
import { config } from './config.ts'

/**
 * SQLite bawaan Node — tidak ada native module yang perlu dikompilasi, jadi
 * `npm install` tidak bisa gagal karena toolchain. Skemanya SQL biasa, jadi
 * pindah ke Postgres nanti tinggal mengganti driver, bukan menulis ulang.
 */
export const db = new DatabaseSync(config.databaseFile)

db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

/**
 * Skema dibuat sekali dan idempoten. Untuk aplikasi sebesar ini itu cukup;
 * begitu ada rilis kedua yang mengubah kolom, ganti dengan migrasi bernomor.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    -- Nomor HP dan email boleh kosong: seseorang bisa masuk lewat Google
    -- tanpa pernah memberi nomor, dan lewat OTP tanpa pernah memberi email.
    phone          TEXT UNIQUE,
    phone_verified INTEGER NOT NULL DEFAULT 0,
    email          TEXT UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    password_hash  TEXT,
    role           TEXT NOT NULL DEFAULT 'member',
    created_at     TEXT NOT NULL
  );

  -- Satu user bisa punya beberapa cara masuk. Tabel terpisah supaya
  -- menambah penyedia baru tidak berarti menambah kolom di users.
  CREATE TABLE IF NOT EXISTS identities (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider     TEXT NOT NULL,
    subject      TEXT NOT NULL,
    email        TEXT,
    created_at   TEXT NOT NULL,
    UNIQUE (provider, subject)
  );

  -- Sesi opaque: yang disimpan hanya hash-nya, jadi bocornya isi database
  -- tidak langsung berarti bocornya sesi aktif.
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  -- Kode OTP juga di-hash. Kolom attempts membuat tebak-tebakan terbatas.
  CREATE TABLE IF NOT EXISTS otp_codes (
    id         TEXT PRIMARY KEY,
    phone      TEXT NOT NULL,
    code_hash  TEXT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    consumed   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS email_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  -- State OAuth beserta verifier PKCE-nya, umur pendek.
  CREATE TABLE IF NOT EXISTS oauth_states (
    state         TEXT PRIMARY KEY,
    provider      TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone, consumed);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_identities_user ON identities(user_id);
`)

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
export function purgeExpired(now: Date = new Date()): void {
  const iso = now.toISOString()
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(iso)
  db.prepare('DELETE FROM otp_codes WHERE expires_at < ?').run(iso)
  db.prepare('DELETE FROM email_tokens WHERE expires_at < ?').run(iso)
  db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').run(iso)
}

/** Hanya untuk tes: mengosongkan seluruh tabel. */
export function resetDatabase(): void {
  for (const table of [
    'sessions',
    'otp_codes',
    'email_tokens',
    'oauth_states',
    'identities',
    'users',
  ]) {
    db.exec(`DELETE FROM ${table}`)
  }
}
