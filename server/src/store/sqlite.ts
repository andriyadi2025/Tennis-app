import { DatabaseSync } from 'node:sqlite'
import type { RunResult, Sql } from './sql.ts'

/**
 * Driver SQLite bawaan Node — tidak ada native module yang perlu
 * dikompilasi, jadi `npm install` tidak bisa gagal karena toolchain.
 *
 * API-nya sinkron, tapi dibungkus jadi async supaya sama bentuknya dengan
 * Postgres. Membungkus yang sinkron jadi async itu murah; sebaliknya tidak
 * mungkin.
 */

/** SQLite hanya menerima tipe primitif; boolean dan Date diubah di sini. */
function toSqliteValue(value: unknown): string | number | bigint | null | Uint8Array {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return value
  }
  if (value instanceof Uint8Array) return value
  // Objek dan array tidak punya padanan kolom; menyimpannya sebagai
  // "[object Object]" adalah kegagalan diam-diam, jadi ditolak di sini.
  throw new TypeError(`Nilai parameter tidak didukung: ${typeof value}`)
}

function bind(params: readonly unknown[]): (string | number | bigint | null | Uint8Array)[] {
  return params.map(toSqliteValue)
}

export class SqliteSql implements Sql {
  readonly dialect = 'sqlite' as const
  readonly #db: DatabaseSync
  /** Transaksi SQLite tidak bisa bersarang; kedalamannya dilacak di sini. */
  #depth = 0

  constructor(file: string) {
    this.#db = new DatabaseSync(file)
    this.#db.exec('PRAGMA journal_mode = WAL')
    this.#db.exec('PRAGMA foreign_keys = ON')
  }

  async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | undefined> {
    return this.#db.prepare(sql).get(...bind(params)) as T | undefined
  }

  async all<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return this.#db.prepare(sql).all(...bind(params)) as T[]
  }

  async run(sql: string, params: readonly unknown[] = []): Promise<RunResult> {
    const result = this.#db.prepare(sql).run(...bind(params))
    return { changes: Number(result.changes) }
  }

  async exec(sql: string): Promise<void> {
    this.#db.exec(sql)
  }

  async transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
    /*
     * Transaksi bersarang dijalankan apa adanya di dalam transaksi luar.
     * SQLite akan menolak BEGIN kedua, dan menyembunyikannya di balik
     * SAVEPOINT hanya menambah cara untuk salah — pemanggil yang bersarang
     * memang bermaksud ikut transaksi yang sedang berjalan.
     */
    if (this.#depth > 0) return fn(this)

    this.#depth += 1
    this.#db.exec('BEGIN')
    try {
      const result = await fn(this)
      this.#db.exec('COMMIT')
      return result
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    } finally {
      this.#depth -= 1
    }
  }

  async close(): Promise<void> {
    this.#db.close()
  }
}
