import express from 'express'
import { config, providerStatus, readiness } from './config.ts'
import { db } from './db.ts'
import { routes } from './routes.ts'
import { domainRoutes } from './domain/routes.ts'
import { applyWebhook } from './domain/payments.ts'
import { paymentProvider } from './payments/index.ts'

/**
 * Pabrik app dipisah dari listener supaya tes bisa memakai app yang sama
 * persis dengan yang dijalankan produksi — bukan tiruan yang mirip.
 */
export function createApp() {
  const app = express()

  /*
   * Webhook dibaca sebagai teks mentah, bukan JSON yang sudah di-parse.
   * Tanda tangannya dihitung atas byte yang benar-benar dikirim penyedia, dan
   * JSON.parse lalu JSON.stringify tidak menghasilkan byte yang sama — urutan
   * kunci dan spasi bisa berubah, dan tanda tangannya jadi tidak pernah cocok.
   *
   * Dipasang sebelum express.json supaya rute ini tidak keburu diambilnya.
   */
  app.post(
    '/api/payments/webhook',
    express.text({ type: '*/*', limit: '64kb' }),
    async (req, res) => {
      const raw = typeof req.body === 'string' ? req.body : ''
      const headers: Record<string, string | undefined> = {}
      for (const [key, value] of Object.entries(req.headers)) {
        headers[key] = Array.isArray(value) ? value[0] : value
      }

      const event = paymentProvider().verifyWebhook(raw, headers)
      /*
       * Tanda tangan tidak cocok. Dijawab 401 tanpa keterangan: endpoint ini
       * publik, dan menjelaskan bagian mana yang salah membantu orang yang
       * sedang mencoba memalsukannya.
       */
      if (!event) {
        res.status(401).json({ ok: false })
        return
      }

      const outcome = await applyWebhook(event)
      /*
       * Penyedia mengirim ulang apa pun yang tidak dijawab 2xx. Untuk keadaan
       * yang tidak akan berubah — pembayaran tidak dikenal, jumlah tidak cocok
       * — 200 yang dikembalikan, supaya tidak dicoba selamanya. Yang tidak
       * beres tetap tercatat di log.
       */
      if (!outcome.ok) {
        console.warn('[webhook ditolak]', outcome.reason, event.paymentId)
        res.json({ ok: false, reason: outcome.reason })
        return
      }
      res.json({ ok: true, status: outcome.payment.status })
    },
  )

  app.use(express.json({ limit: '64kb' }))

  /*
   * CORS ditulis tangan, bukan lewat dependensi: yang dibutuhkan cuma satu
   * asal yang sudah diketahui, dan aturan sempit lebih mudah diperiksa
   * daripada pustaka serba bisa dengan bawaan yang longgar.
   */
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', config.appOrigin)
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    res.header('Vary', 'Origin')
    if (req.method === 'OPTIONS') {
      res.sendStatus(204)
      return
    }
    next()
  })

  /*
   * Health check menyebut juga apa yang belum layak produksi. Deploy yang
   * berhasil tapi salah konfigurasi tampak persis sama dengan yang benar
   * dari luar; ini yang membedakannya tanpa perlu membaca log start-up.
   */
  app.get('/api/health', (_req, res) => {
    const issues = readiness()
    res.json({
      ok: true,
      database: db.dialect,
      providers: providerStatus(),
      readiness: {
        ok: issues.every((i) => i.level !== 'fatal'),
        issues,
      },
    })
  })

  app.use('/api/auth', routes)

  /*
   * Domain dipasang setelah auth, di prefiks yang sama-sama `/api`. Dulu
   * seluruh bagian ini dilayani MSW di dalam browser: enak untuk merancang
   * layar, tapi tidak pernah menguji kepemilikan — di browser hanya ada satu
   * orang, jadi "booking siapa ini" tidak pernah jadi pertanyaan.
   */
  app.use('/api', domainRoutes)

  // Penanganan error terakhir — stack tidak pernah dibocorkan ke klien.
  app.use(
    (error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error('[unhandled]', error)
      res.status(500).json({ code: 'INTERNAL', message: 'Terjadi kesalahan di server.' })
    },
  )

  return app
}
