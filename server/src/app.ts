import express from 'express'
import { config, providerStatus, readiness } from './config.ts'
import { db } from './db.ts'
import { routes } from './routes.ts'

/**
 * Pabrik app dipisah dari listener supaya tes bisa memakai app yang sama
 * persis dengan yang dijalankan produksi — bukan tiruan yang mirip.
 */
export function createApp() {
  const app = express()
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

  // Penanganan error terakhir — stack tidak pernah dibocorkan ke klien.
  app.use(
    (error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error('[unhandled]', error)
      res.status(500).json({ code: 'INTERNAL', message: 'Terjadi kesalahan di server.' })
    },
  )

  return app
}
