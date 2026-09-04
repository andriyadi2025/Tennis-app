import type { Sql } from '../store/index.ts'

/**
 * Skema domain: lapangan, booking, komunitas, toko, aduan.
 *
 * Dua bentuk penyimpanan dipakai sengaja.
 *
 * Kolom sungguhan untuk apa pun yang **dicari, disaring, atau diubah
 * sendiri-sendiri**: booking, pesanan toko, aduan, pesan, notifikasi. Ini
 * yang di-query dengan WHERE dan ORDER BY, dan menyimpannya sebagai JSON
 * berarti memuat seluruh tabel ke memori tiap kali.
 *
 * Kolom JSON untuk agregat yang **selalu dibaca utuh**: lapangan di dalam
 * venue, anggota di dalam tim, varian di dalam barang. Memecahnya jadi tabel
 * sendiri menambah join untuk data yang tidak pernah diminta terpisah.
 *
 * Waktu selalu TEXT ISO 8601 UTC — mengurut sama secara leksikografis dan
 * kronologis, jadi perbandingannya identik di SQLite dan Postgres.
 */
const TABLES = `
  -- Referensi klub

  CREATE TABLE IF NOT EXISTS venues (
    id   TEXT PRIMARY KEY,
    -- Venue beserta lapangannya; lapangan tidak pernah dibaca tanpa venuenya.
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS club_settings (
    id   INTEGER PRIMARY KEY,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id          TEXT PRIMARY KEY,
    venue_id    TEXT NOT NULL,
    author_id   TEXT,
    author_name TEXT NOT NULL,
    rating      INTEGER NOT NULL,
    body        TEXT NOT NULL,
    tags        TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  -- Profil main
  -- Terpisah dari tabel users milik auth: yang ini poin, tier, dan cabang
  -- favorit. Auth tahu siapa orangnya; ini tahu bagaimana ia bermain.

  CREATE TABLE IF NOT EXISTS profiles (
    user_id         TEXT PRIMARY KEY,
    points          INTEGER NOT NULL DEFAULT 0,
    tier            TEXT NOT NULL DEFAULT 'Rookie',
    favourite_sport TEXT NOT NULL DEFAULT 'tennis',
    is_member       INTEGER NOT NULL DEFAULT 0,
    joined_at       TEXT NOT NULL
  );

  -- Booking

  CREATE TABLE IF NOT EXISTS bookings (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL,
    venue_id         TEXT NOT NULL,
    venue_name       TEXT NOT NULL,
    court_id         TEXT NOT NULL,
    court_name       TEXT NOT NULL,
    sport            TEXT NOT NULL,
    starts_at        TEXT NOT NULL,
    ends_at          TEXT NOT NULL,
    hours            INTEGER NOT NULL,
    recurrence       TEXT,
    purpose          TEXT NOT NULL DEFAULT 'bermain',
    add_ons          TEXT NOT NULL DEFAULT '[]',
    split_bill       TEXT,
    status           TEXT NOT NULL,
    payment_method   TEXT,
    code             TEXT NOT NULL,
    subtotal_idr     INTEGER NOT NULL,
    points_redeemed  INTEGER NOT NULL DEFAULT 0,
    discount_idr     INTEGER NOT NULL DEFAULT 0,
    service_fee_idr  INTEGER NOT NULL DEFAULT 0,
    total_idr        INTEGER NOT NULL,
    payment_deadline TEXT,
    created_at       TEXT NOT NULL
  );

  -- Slot yang sudah dikunci booking. Baris sendiri, bukan JSON: inilah yang
  -- ditanya paling sering ("jam ini masih kosong?") dan paling perlu unik.
  CREATE TABLE IF NOT EXISTS taken_slots (
    court_id   TEXT NOT NULL,
    starts_at  TEXT NOT NULL,
    booking_id TEXT NOT NULL,
    PRIMARY KEY (court_id, starts_at)
  );

  -- Komunitas

  CREATE TABLE IF NOT EXISTS open_matches (
    id        TEXT PRIMARY KEY,
    starts_at TEXT NOT NULL,
    sport     TEXT NOT NULL,
    data      TEXT NOT NULL
  );

  -- Pemain jadi baris sendiri: siapa yang ikut adalah pertanyaan per-user,
  -- dan menyimpannya di dalam JSON membuat "match apa saja yang saya ikuti"
  -- berarti memindai seluruh tabel.
  CREATE TABLE IF NOT EXISTS open_match_players (
    match_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    name     TEXT NOT NULL,
    level    TEXT NOT NULL,
    PRIMARY KEY (match_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS teams (
    id       TEXT PRIMARY KEY,
    sport    TEXT NOT NULL,
    -- Pembuat tim. Kosong untuk tim bawaan: pemiliknya bukan akun di sini.
    owner_id TEXT,
    data     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS team_members (
    team_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name    TEXT NOT NULL,
    level   TEXT NOT NULL,
    PRIMARY KEY (team_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS tournaments (
    id          TEXT PRIMARY KEY,
    starts_at   TEXT NOT NULL,
    status      TEXT NOT NULL,
    slots_taken INTEGER NOT NULL DEFAULT 0,
    data        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS registrations (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    tournament_id   TEXT NOT NULL,
    tournament_name TEXT NOT NULL,
    entry_fee_idr   INTEGER NOT NULL,
    payment_method  TEXT NOT NULL,
    payment_status  TEXT NOT NULL,
    code            TEXT NOT NULL,
    registered_at   TEXT NOT NULL,
    UNIQUE (user_id, tournament_id)
  );

  -- Obrolan
  -- Pesan jadi tabel sendiri, bukan JSON di dalam utas: pesan datang satu
  -- per satu dan dibaca berurutan, dan realtime mengirimkannya satu per satu
  -- juga. JSON berarti menulis ulang seluruh utas tiap satu kalimat masuk.

  CREATE TABLE IF NOT EXISTS chats (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    subtitle   TEXT NOT NULL,
    booking_id TEXT
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id                    TEXT PRIMARY KEY,
    chat_id               TEXT NOT NULL,
    author_id             TEXT NOT NULL,
    author_name           TEXT NOT NULL,
    body                  TEXT NOT NULL,
    sent_at               TEXT NOT NULL,
    split_card_booking_id TEXT
  );

  -- Sparring
  -- Waktu bisa dinegosiasikan, jadi usulan jadi tabel sendiri. Menyimpan
  -- hanya "waktu terakhir yang diusulkan" menghapus jejak siapa mengusulkan
  -- apa — dan itu persis yang dipersoalkan saat kedua tim tidak sepakat.

  CREATE TABLE IF NOT EXISTS sparring (
    id             TEXT PRIMARY KEY,
    from_team_id   TEXT NOT NULL,
    from_team_name TEXT NOT NULL,
    to_team_id     TEXT NOT NULL,
    to_team_name   TEXT NOT NULL,
    sport          TEXT NOT NULL,
    proposed_at    TEXT,
    venue_name     TEXT,
    message        TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sparring_proposals (
    id          TEXT PRIMARY KEY,
    sparring_id TEXT NOT NULL,
    -- Sisi mana yang mengusulkan: 'tuan' (pemilik ajakan) atau 'lawan'.
    by_side     TEXT NOT NULL,
    by_name     TEXT NOT NULL,
    proposed_at TEXT NOT NULL,
    venue_name  TEXT,
    note        TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  -- Notifikasi

  CREATE TABLE IF NOT EXISTS notifications (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    kind       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    href       TEXT,
    read       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  -- Toko

  CREATE TABLE IF NOT EXISTS merch_items (
    id       TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    active   INTEGER NOT NULL DEFAULT 1,
    -- Varian dan stoknya; tidak pernah dibaca tanpa barangnya.
    data     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS merch_orders (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL,
    item_id        TEXT NOT NULL,
    item_name      TEXT NOT NULL,
    variant_id     TEXT NOT NULL,
    variant_label  TEXT NOT NULL,
    qty            INTEGER NOT NULL,
    pay_mode       TEXT NOT NULL,
    payment_method TEXT,
    total_idr      INTEGER NOT NULL DEFAULT 0,
    points_spent   INTEGER NOT NULL DEFAULT 0,
    points_earned  INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL,
    code           TEXT NOT NULL,
    created_at     TEXT NOT NULL
  );

  -- Aduan

  CREATE TABLE IF NOT EXISTS complaints (
    id            TEXT PRIMARY KEY,
    code          TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    user_name     TEXT NOT NULL,
    category      TEXT NOT NULL,
    subject       TEXT NOT NULL,
    status        TEXT NOT NULL,
    related_kind  TEXT,
    related_id    TEXT,
    related_label TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS complaint_messages (
    id           TEXT PRIMARY KEY,
    complaint_id TEXT NOT NULL,
    author_role  TEXT NOT NULL,
    author_name  TEXT NOT NULL,
    body         TEXT NOT NULL,
    sent_at      TEXT NOT NULL
  );

  -- Poin partisipasi yang sudah dikreditkan
  -- Jumlahnya ikut disimpan, bukan cuma idnya: kalau admin menurunkan poin
  -- Lomba, riwayat lama tetap harus menulis angka yang dulu masuk ke saldo.

  CREATE TABLE IF NOT EXISTS activity_awards (
    user_id     TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    points      INTEGER NOT NULL,
    awarded_at  TEXT NOT NULL,
    PRIMARY KEY (user_id, activity_id)
  );

  CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id, starts_at);
  CREATE INDEX IF NOT EXISTS idx_reviews_venue ON reviews(venue_id);
  CREATE INDEX IF NOT EXISTS idx_chat_messages ON chat_messages(chat_id, sent_at);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_merch_orders_user ON merch_orders(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_complaints_user ON complaints(user_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_complaint_messages ON complaint_messages(complaint_id, sent_at);
  CREATE INDEX IF NOT EXISTS idx_players_user ON open_match_players(user_id);
  CREATE INDEX IF NOT EXISTS idx_proposals ON sparring_proposals(sparring_id, created_at);
`

export const DOMAIN_TABLES = [
  'taken_slots',
  'bookings',
  'reviews',
  'open_match_players',
  'open_matches',
  'team_members',
  'teams',
  'registrations',
  'tournaments',
  'chat_messages',
  'chats',
  'sparring_proposals',
  'sparring',
  'notifications',
  'merch_orders',
  'merch_items',
  'complaint_messages',
  'complaints',
  'activity_awards',
  'profiles',
  'club_settings',
  'venues',
] as const

/**
 * Kolom yang lahir setelah tabelnya pertama dibuat.
 *
 * `CREATE TABLE IF NOT EXISTS` tidak menyentuh tabel yang sudah ada, jadi
 * basis data lama tidak akan pernah mendapatkannya — dan kegagalannya baru
 * terlihat saat kolomnya dipakai, jauh dari penyebabnya.
 */
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  { table: 'teams', column: 'owner_id', definition: 'TEXT' },
]

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

export async function migrateDomain(sql: Sql): Promise<void> {
  await sql.exec(TABLES)
  for (const { table, column, definition } of ADDED_COLUMNS) {
    await addColumn(sql, table, column, definition)
  }
}

export async function truncateDomain(sql: Sql): Promise<void> {
  for (const table of DOMAIN_TABLES) {
    await sql.run(`DELETE FROM ${table}`)
  }
}
