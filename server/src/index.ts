import { createApp } from './app.ts'
import { config, providerStatus } from './config.ts'
import { purgeExpired } from './db.ts'

// Baris kedaluwarsa dibersihkan berkala, bukan di jalur permintaan.
setInterval(() => purgeExpired(), 10 * 60_000).unref()

createApp().listen(config.port, () => {
  const status = providerStatus()
  console.info(`DBTC auth server jalan di http://localhost:${config.port}`)
  console.info(`  Google   : ${status.google ? 'siap' : 'belum dikonfigurasi'}`)
  console.info(`  Facebook : ${status.facebook ? 'siap' : 'belum dikonfigurasi'}`)
  console.info(`  SMS      : ${status.smsDelivery === 'twilio' ? 'Twilio' : 'log server'}`)
  console.info(`  Email    : ${status.emailDelivery === 'smtp' ? 'SMTP' : 'log server'}`)
})
