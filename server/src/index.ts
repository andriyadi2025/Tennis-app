import { createApp } from './app.ts'
import { assertReady, config, providerStatus } from './config.ts'
import { db, purgeExpired } from './db.ts'
import { seedDomain } from './domain/store.ts'
import { expireStalePayments } from './domain/payments.ts'

/*
 * Kesiapan diperiksa sebelum port dibuka.
 *
 * Di produksi, masalah fatal — pepper bawaan, APP_ORIGIN tanpa HTTPS —
 * menghentikan start. Server yang menolak jalan itu keras kepala, tapi jauh
 * lebih murah daripada server yang jalan dengan token yang bisa dipalsukan
 * siapa pun yang pernah membuka repositori ini.
 */
assertReady()

// Skema domain dibuat dan data referensi diisi sebelum port dibuka, supaya
// permintaan pertama tidak mendarat di tabel yang belum ada.
await seedDomain()

// Baris kedaluwarsa dibersihkan berkala, bukan di jalur permintaan.
setInterval(() => {
  void purgeExpired().catch((error) => console.error('[purge]', error))
}, 10 * 60_000).unref()

/*
 * Tagihan yang ditinggalkan orangnya ditutup berkala. Tanpa ini, stok pesanan
 * toko yang tidak jadi dibayar tidak pernah kembali ke katalog.
 */
setInterval(() => {
  void expireStalePayments().catch((error) => console.error('[expire]', error))
}, 60_000).unref()

const server = createApp().listen(config.port, () => {
  const status = providerStatus()
  console.info(`DBTC auth server jalan di http://localhost:${config.port}`)
  console.info(`  Basis data : ${db.dialect === 'postgres' ? 'Postgres' : 'SQLite berkas'}`)
  console.info(`  Google     : ${status.google ? 'siap' : 'belum dikonfigurasi'}`)
  console.info(`  Facebook   : ${status.facebook ? 'siap' : 'belum dikonfigurasi'}`)
  console.info(`  SMS        : ${status.smsDelivery === 'twilio' ? 'Twilio' : 'log server'}`)
  console.info(`  Email      : ${status.emailDelivery === 'smtp' ? 'SMTP' : 'log server'}`)
})

/*
 * Koneksi ditutup rapi saat proses dihentikan. Pool Postgres yang tidak
 * ditutup menahan proses tetap hidup, dan penyebar (deployer) yang menunggu
 * akan membunuhnya paksa — yang berarti transaksi berjalan ikut terpotong.
 */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => {
      void db.close().finally(() => process.exit(0))
    })
  })
}
