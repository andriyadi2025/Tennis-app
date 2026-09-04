import type { Sql } from './sql.ts'

/**
 * Skema, ditulis sekali untuk kedua basis data.
 *
 * Yang membuatnya portabel bukan kebetulan: tidak ada AUTOINCREMENT, tidak
 * ada BOOLEAN (0/1 di kolom INTEGER, yang berlaku di keduanya), tidak ada
 * tipe khusus SQLite, dan konflik ditangani dengan ON CONFLICT — bukan
 * INSERT OR IGNORE yang hanya dikenal SQLite.
 *
 * Waktu disimpan sebagai TEXT ISO 8601, bukan TIMESTAMP. Alasannya bukan
 * kemalasan: ISO 8601 UTC mengurut sama persis secara leksikografis dan
 * kronologis, jadi perbandingan `expires_at < ?` bekerja identik di kedua
 * mesin tanpa memikirkan zona waktu bawaan yang berbeda.
 */
const TABLES = `
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
  -- Kolom link_user_id terisi kalau putaran ini untuk menyambung penyedia ke
  -- akun yang sudah masuk, bukan untuk masuk. Sesi tidak bisa dititipkan lewat
  -- URL balik dari penyedia, jadi ia dititipkan di baris state ini.
  CREATE TABLE IF NOT EXISTS oauth_states (
    state         TEXT PRIMARY KEY,
    provider      TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    link_user_id  TEXT,
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL
  );

  -- Langganan push per peramban. Endpoint jadi kuncinya: satu peramban punya
  -- satu endpoint, dan kalau perangkatnya berpindah tangan langganan itu ikut
  -- pemilik barunya, bukan tetap mengirim notifikasi orang sebelumnya.
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint   TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    user_agent TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
  CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone, consumed);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_identities_user ON identities(user_id);
`

/** Urutan penghapusan mengikuti ketergantungan; dipakai tes dan reset. */
export const TABLE_NAMES = [
  'push_subscriptions',
  'sessions',
  'otp_codes',
  'email_tokens',
  'oauth_states',
  'identities',
  'users',
] as const

/**
 * Kolom yang lahir setelah skema pertama dirilis.
 *
 * `CREATE TABLE IF NOT EXISTS` tidak menyentuh tabel yang sudah ada, jadi
 * basis data lama tidak akan pernah mendapatkannya — dan kegagalannya baru
 * terlihat saat kolomnya dipakai. Ditambahkan di sini, aman diulang.
 */
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  { table: 'oauth_states', column: 'link_user_id', definition: 'TEXT' },
]

/**
 * Menambah kolom dengan cara yang tersedia di masing-masing mesin.
 *
 * Postgres punya `ADD COLUMN IF NOT EXISTS`; SQLite tidak, jadi di sana
 * daftar kolomnya diperiksa dulu. Yang sengaja **tidak** dilakukan adalah
 * menjalankan ALTER lalu menelan errornya: itu juga menelan kesalahan lain
 * — tipe salah, tabel tidak ada — dan menyembunyikannya sampai jauh
 * kemudian.
 */
async function addColumn(
  sql: Sql,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  const existing =
    sql.dialect === 'postgres'
      ? (
          await sql.all<{ column_name: string }>(
            'SELECT column_name FROM information_schema.columns WHERE table_name = ?',
            [table],
          )
        ).map((r) => r.column_name)
      : (await sql.all<{ name: string }>(`PRAGMA table_info(${table})`)).map((r) => r.name)

  if (existing.includes(column)) return
  await sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

export async function migrate(sql: Sql): Promise<void> {
  await sql.exec(TABLES)
  for (const { table, column, definition } of ADDED_COLUMNS) {
    await addColumn(sql, table, column, definition)
  }
}

/** Hanya untuk tes: mengosongkan seluruh tabel. */
export async function truncateAll(sql: Sql): Promise<void> {
  for (const table of TABLE_NAMES) {
    await sql.run(`DELETE FROM ${table}`)
  }
}
