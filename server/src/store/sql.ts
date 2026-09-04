/**
 * Satu antarmuka untuk dua basis data.
 *
 * SQLite cukup untuk satu instance dan tidak perlu dipasang. Begitu app
 * dijalankan lebih dari satu proses, berkas SQLite tidak bisa dibagi dan
 * Postgres jadi keharusan. Yang membuat perpindahan itu mungkin bukan
 * "SQL-nya standar" — melainkan kode di atasnya tidak pernah menyentuh
 * driver mana pun secara langsung.
 *
 * Semuanya async, termasuk driver SQLite yang sebenarnya sinkron. Kalau
 * antarmukanya sinkron, Postgres tidak akan pernah bisa masuk tanpa menulis
 * ulang setiap pemanggil — dan penulisan ulang itulah yang biasanya tidak
 * pernah terjadi.
 */

export type Dialect = 'sqlite' | 'postgres'

export interface RunResult {
  /** Jumlah baris yang benar-benar berubah. */
  changes: number
}

export interface Sql {
  readonly dialect: Dialect

  /** Satu baris, atau undefined kalau tidak ada. */
  get<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined>

  all<T>(sql: string, params?: readonly unknown[]): Promise<T[]>

  run(sql: string, params?: readonly unknown[]): Promise<RunResult>

  /** Beberapa pernyataan sekaligus, tanpa parameter — dipakai skema. */
  exec(sql: string): Promise<void>

  /**
   * Semua atau tidak sama sekali. Yang di dalam callback wajib memakai `tx`
   * yang diberikan, bukan koneksi luar: di Postgres transaksi terikat pada
   * satu koneksi, dan memakai pool di dalamnya diam-diam menjalankan
   * pernyataan di luar transaksi.
   */
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>

  close(): Promise<void>
}

/**
 * SQL ditulis satu gaya — `?` — lalu diterjemahkan untuk Postgres yang
 * memakai `$1`. Menulis dua versi tiap query berarti dua kesempatan untuk
 * berbeda, dan yang berbeda biasanya yang jarang dijalankan.
 *
 * Tanda tanya di dalam string literal dilewati; tanpa itu, kalimat seperti
 * `'Sudah dibayar?'` akan ikut jadi placeholder dan jumlah parameternya
 * meleset.
 */
export function toPositional(sql: string): string {
  let out = ''
  let index = 0
  let inString = false

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]!
    if (inString) {
      out += ch
      // '' di dalam string adalah kutip yang di-escape, bukan penutup.
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          out += "'"
          i += 1
        } else {
          inString = false
        }
      }
      continue
    }
    if (ch === "'") {
      inString = true
      out += ch
      continue
    }
    if (ch === '?') {
      index += 1
      out += `$${index}`
      continue
    }
    out += ch
  }

  return out
}
