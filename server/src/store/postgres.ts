import type { Pool, PoolClient, QueryResultRow } from 'pg'
import type { RunResult, Sql } from './sql.ts'
import { toPositional } from './sql.ts'

/**
 * Driver Postgres. Dipakai begitu app dijalankan lebih dari satu proses —
 * berkas SQLite tidak bisa dibagi antar instance, dan membaginya lewat
 * berkas jaringan adalah cara yang sudah dikenal untuk merusaknya.
 *
 * Query ditulis dengan `?` seperti sisanya, lalu diterjemahkan ke `$1`.
 */

/** Sesuatu yang bisa menjalankan query: pool, atau satu koneksi transaksi. */
interface Queryable {
  query<R extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>
}

export class PostgresSql implements Sql {
  readonly dialect = 'postgres' as const
  readonly #run: Queryable
  readonly #pool: Pool | null

  /**
   * `pool` diisi hanya oleh instance terluar. Instance transaksi memegang
   * satu koneksi dan tidak boleh menutup pool milik bersama.
   */
  constructor(runner: Queryable, pool: Pool | null) {
    this.#run = runner
    this.#pool = pool
  }

  async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | undefined> {
    const { rows } = await this.#run.query<QueryResultRow>(toPositional(sql), [...params])
    return rows[0] as T | undefined
  }

  async all<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const { rows } = await this.#run.query<QueryResultRow>(toPositional(sql), [...params])
    return rows as T[]
  }

  async run(sql: string, params: readonly unknown[] = []): Promise<RunResult> {
    const result = await this.#run.query<QueryResultRow>(toPositional(sql), [...params])
    return { changes: result.rowCount ?? 0 }
  }

  async exec(sql: string): Promise<void> {
    // Tanpa parameter, jadi tidak ada yang perlu diterjemahkan.
    await this.#run.query(sql)
  }

  async transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
    if (!this.#pool) {
      // Sudah di dalam transaksi: ikut yang sedang berjalan, jangan buka
      // koneksi kedua — pernyataannya akan mendarat di luar transaksi.
      return fn(this)
    }

    const client: PoolClient = await this.#pool.connect()
    const scoped = new PostgresSql(client, null)
    try {
      await client.query('BEGIN')
      const result = await fn(scoped)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.#pool?.end()
  }
}

/** Pool sungguhan; dipisah supaya tes bisa menyuntik pool tiruan. */
export async function connectPostgres(connectionString: string): Promise<Sql> {
  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString })
  return new PostgresSql(pool, pool)
}
