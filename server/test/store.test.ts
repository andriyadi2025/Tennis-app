import { beforeEach, describe, expect, it } from 'vitest'
import { newDb } from 'pg-mem'
import { PostgresSql, SqliteSql, migrate, toPositional, truncateAll } from '../src/store/index.ts'
import type { Sql } from '../src/store/index.ts'

/**
 * Adapter Postgres diuji terhadap pg-mem, bukan cuma di-typecheck.
 *
 * Kode yang tidak pernah dijalankan adalah kode yang belum diketahui benar,
 * dan "nanti diuji saat deploy" berarti diuji oleh pengguna. pg-mem bukan
 * Postgres sungguhan — perbedaan tipe dan fitur pinggiran tetap mungkin —
 * tapi ia menjalankan SQL yang sama dan menangkap kesalahan yang paling
 * mungkin: placeholder, dialek, dan bentuk hasil.
 */

function postgres(): Sql {
  const mem = newDb()
  const pg = mem.adapters.createPg()
  const pool = new pg.Pool()
  return new PostgresSql(pool, pool)
}

function sqlite(): Sql {
  return new SqliteSql(':memory:')
}

describe('toPositional', () => {
  it('mengubah tanda tanya jadi $1, $2 sesuai urutan', () => {
    expect(toPositional('SELECT * FROM t WHERE a = ? AND b = ?')).toBe(
      'SELECT * FROM t WHERE a = $1 AND b = $2',
    )
  })

  it('melewati tanda tanya di dalam string literal', () => {
    // Tanpa ini, kalimat seperti 'Sudah dibayar?' ikut jadi placeholder dan
    // jumlah parameternya meleset — kegagalan yang jauh dari penyebabnya.
    expect(toPositional("UPDATE t SET label = 'Sudah dibayar?' WHERE id = ?")).toBe(
      "UPDATE t SET label = 'Sudah dibayar?' WHERE id = $1",
    )
  })

  it('memahami kutip yang di-escape di dalam string', () => {
    expect(toPositional("SELECT 'it''s ? here' , ? FROM t")).toBe(
      "SELECT 'it''s ? here' , $1 FROM t",
    )
  })

  it('membiarkan query tanpa parameter apa adanya', () => {
    expect(toPositional('SELECT 1')).toBe('SELECT 1')
  })
})

/**
 * Perilaku yang sama diminta dari kedua driver. Kalau salah satunya
 * menyimpang, seluruh kode di atasnya diam-diam bergantung pada driver
 * tertentu — dan itu baru terasa saat pindah.
 */
describe.each([
  ['sqlite', sqlite],
  ['postgres', postgres],
])('driver %s', (_name, make) => {
  let db: Sql

  beforeEach(async () => {
    db = make()
    await migrate(db)
    await truncateAll(db)
  })

  async function addUser(id: string, name = 'Raka') {
    await db.run(
      `INSERT INTO users (id, name, phone, phone_verified, email, email_verified, password_hash, role, created_at)
       VALUES (?, ?, NULL, 0, NULL, 0, NULL, 'member', ?)`,
      [id, name, new Date().toISOString()],
    )
  }

  it('menjalankan skema dan menyimpan lalu membaca kembali', async () => {
    await addUser('u-1')
    const row = await db.get<{ id: string; name: string }>('SELECT * FROM users WHERE id = ?', [
      'u-1',
    ])
    expect(row?.name).toBe('Raka')
  })

  it('mengembalikan undefined, bukan melempar, untuk baris yang tidak ada', async () => {
    expect(await db.get('SELECT * FROM users WHERE id = ?', ['tidak-ada'])).toBeUndefined()
  })

  it('melaporkan jumlah baris yang berubah', async () => {
    await addUser('u-1')
    await addUser('u-2')
    const { changes } = await db.run("UPDATE users SET role = 'admin' WHERE id = ?", ['u-1'])
    expect(changes).toBe(1)
    expect((await db.run('DELETE FROM users WHERE id = ?', ['u-9'])).changes).toBe(0)
  })

  it('mengurutkan waktu ISO secara leksikografis sama dengan kronologis', async () => {
    // Inilah alasan waktu disimpan sebagai TEXT dan bukan TIMESTAMP: tidak
    // ada zona waktu bawaan yang berbeda antar mesin.
    await addUser('u-lama')
    await db.run('UPDATE users SET created_at = ? WHERE id = ?', [
      '2026-01-01T00:00:00.000Z',
      'u-lama',
    ])
    await addUser('u-baru')
    await db.run('UPDATE users SET created_at = ? WHERE id = ?', [
      '2026-09-01T00:00:00.000Z',
      'u-baru',
    ])

    const rows = await db.all<{ id: string }>('SELECT id FROM users ORDER BY created_at DESC')
    expect(rows.map((r) => r.id)).toEqual(['u-baru', 'u-lama'])
  })

  it('memaafkan konflik yang diharapkan lewat ON CONFLICT DO NOTHING', async () => {
    await addUser('u-1')
    const insert = () =>
      db.run(
        `INSERT INTO identities (id, user_id, provider, subject, email, created_at)
         VALUES (?, ?, 'google', 'sub-1', NULL, ?)
         ON CONFLICT (provider, subject) DO NOTHING`,
        [`id-${Math.random()}`, 'u-1', new Date().toISOString()],
      )

    await insert()
    // Kedua kalinya tidak boleh melempar — INSERT OR IGNORE hanya dikenal
    // SQLite, jadi yang dipakai harus yang berlaku di keduanya.
    await expect(insert()).resolves.toBeDefined()
    expect(await db.all('SELECT * FROM identities')).toHaveLength(1)
  })

  it('mengembalikan COUNT sebagai sesuatu yang bisa di-Number()', async () => {
    // Postgres mengembalikan bigint sebagai string; SQLite sebagai number.
    // Kode di atasnya membungkusnya dengan Number(), dan ini yang menjaga
    // asumsi itu tetap benar di kedua driver.
    await addUser('u-1')
    const row = await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM users')
    expect(Number(row?.count)).toBe(1)
  })

  it('menyimpan perubahan kalau transaksi selesai', async () => {
    await db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO users (id, name, phone, phone_verified, email, email_verified, password_hash, role, created_at)
         VALUES (?, 'Dalam transaksi', NULL, 0, NULL, 0, NULL, 'member', ?)`,
        ['u-tx', new Date().toISOString()],
      )
    })
    expect(await db.get('SELECT * FROM users WHERE id = ?', ['u-tx'])).toBeDefined()
  })

  it('meneruskan kegagalan ke pemanggil, tidak menelannya', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO users (id, name, phone, phone_verified, email, email_verified, password_hash, role, created_at)
           VALUES (?, 'Batal', NULL, 0, NULL, 0, NULL, 'member', ?)`,
          ['u-batal', new Date().toISOString()],
        )
        throw new Error('gagal di tengah')
      }),
    ).rejects.toThrow('gagal di tengah')
  })

  it('menerima null untuk kolom yang boleh kosong', async () => {
    await addUser('u-1')
    const row = await db.get<{ phone: string | null }>('SELECT phone FROM users WHERE id = ?', [
      'u-1',
    ])
    expect(row?.phone).toBeNull()
  })
})

/**
 * Rollback diuji hanya di SQLite.
 *
 * pg-mem tidak menghormati ROLLBACK sama sekali — dibuktikan langsung: BEGIN,
 * INSERT, ROLLBACK pada satu client dari pool tetap menyisakan barisnya.
 * Menjalankan kasus ini di sana akan gagal karena tiruannya, bukan karena
 * adapternya, dan tes yang gagal bukan karena kodenya adalah tes yang cepat
 * atau lambat dimatikan.
 *
 * Yang diuji di sini tetap kontrak yang sama yang dipanggil kedua driver.
 * Perilaku rollback Postgres sungguhan belum terbukti di sini — itu perlu
 * Postgres beneran di CI.
 */
describe('yang hanya bisa diuji di SQLite', () => {
  it('menjalankan migrasi dua kali tanpa keluhan', async () => {
    // Server memanggil migrate() tiap boot, jadi idempotensinya bukan
    // kemewahan. pg-mem menolak menjalankan ulang CREATE TABLE IF NOT EXISTS
    // yang punya primary key; Postgres sungguhan menganggapnya no-op.
    const db = new SqliteSql(':memory:')
    await migrate(db)
    await expect(migrate(db)).resolves.toBeUndefined()
    await db.close()
  })

  it('membatalkan seluruhnya kalau ada yang gagal di tengah', async () => {
    const db = new SqliteSql(':memory:')
    await migrate(db)

    await expect(
      db.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO users (id, name, phone, phone_verified, email, email_verified, password_hash, role, created_at)
           VALUES ('u-batal', 'Batal', NULL, 0, NULL, 0, NULL, 'member', ?)`,
          [new Date().toISOString()],
        )
        throw new Error('gagal di tengah')
      }),
    ).rejects.toThrow('gagal di tengah')

    // Setengah jadi lebih buruk daripada tidak jadi.
    expect(await db.get('SELECT * FROM users WHERE id = ?', ['u-batal'])).toBeUndefined()
    await db.close()
  })
})
