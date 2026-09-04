import { config } from '../config.ts'
import { migrate } from './schema.ts'
import { SqliteSql } from './sqlite.ts'
import { connectPostgres } from './postgres.ts'
import type { Sql } from './sql.ts'

export type { Sql, Dialect, RunResult } from './sql.ts'
export { toPositional } from './sql.ts'
export { SqliteSql } from './sqlite.ts'
export { PostgresSql } from './postgres.ts'
export { migrate, truncateAll, TABLE_NAMES } from './schema.ts'

/**
 * Driver dipilih dari konfigurasi, bukan dari flag terpisah: kalau
 * `DATABASE_URL` ada, itu Postgres; kalau tidak, SQLite berkas.
 *
 * Satu variabel, bukan dua yang bisa saling bertentangan — tidak ada keadaan
 * "pakai Postgres tapi URL-nya kosong" yang perlu ditangani.
 */
export async function createStore(): Promise<Sql> {
  const sql = config.databaseUrl
    ? await connectPostgres(config.databaseUrl)
    : new SqliteSql(config.databaseFile)
  await migrate(sql)
  return sql
}
