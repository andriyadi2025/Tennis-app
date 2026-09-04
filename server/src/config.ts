/**
 * Konfigurasi dibaca sekali dari environment, lalu dibekukan.
 *
 * Prinsipnya: kalau kredensial sebuah penyedia tidak diisi, penyedia itu
 * dinyatakan **tidak tersedia** dan endpoint-nya menolak dengan jujur —
 * bukan diam-diam berpura-pura berhasil. Satu-satunya hal yang boleh
 * "berpura-pura" adalah saluran pengiriman di mode pengembangan, dan itu pun
 * mencetak isinya ke log supaya bisa dipakai betulan saat mengembangkan.
 */

function env(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim() !== '' ? value.trim() : undefined
}

function required(name: string, fallback: string): string {
  const value = env(name)
  if (value) return value
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} wajib diisi di produksi.`)
  }
  return fallback
}

/**
 * Pepper bawaan untuk pengembangan. Diberi nama, bukan ditulis inline, supaya
 * pemeriksaan kesiapan deploy bisa mengenalinya kembali — string yang cuma
 * lewat sebagai fallback tidak bisa dideteksi belakangan.
 */
export const DEV_TOKEN_PEPPER = 'pepper-pengembangan-jangan-dipakai-produksi'

/** Panjang minimum pepper yang masih masuk akal untuk HMAC. */
export const MIN_PEPPER_LENGTH = 32

export interface OAuthProvider {
  clientId: string
  clientSecret: string
}

function oauth(prefix: string): OAuthProvider | null {
  const clientId = env(`${prefix}_CLIENT_ID`)
  const clientSecret = env(`${prefix}_CLIENT_SECRET`)
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

export const config = {
  port: Number(env('PORT') ?? 4000),
  isProduction: process.env.NODE_ENV === 'production',

  /** Asal frontend yang boleh memanggil API ini. */
  appOrigin: env('APP_ORIGIN') ?? 'http://localhost:5173',

  /** Berkas SQLite. `:memory:` dipakai tes supaya tiap kasus bersih. */
  databaseFile: env('DATABASE_FILE') ?? 'dbtc.sqlite',

  /*
   * Kalau diisi, Postgres yang dipakai dan DATABASE_FILE diabaikan. Satu
   * variabel yang menentukan drivernya, bukan dua yang bisa bertentangan —
   * tidak ada keadaan "pakai Postgres tapi URL-nya kosong".
   */
  databaseUrl: env('DATABASE_URL') ?? null,

  /**
   * Kunci untuk mem-hash token sesi sebelum disimpan. Bukan untuk JWT —
   * sesi di sini bersifat opaque dan bisa dicabut, yang lebih aman daripada
   * token bertanda tangan yang tidak bisa ditarik sebelum kedaluwarsa.
   */
  tokenPepper: required('TOKEN_PEPPER', DEV_TOKEN_PEPPER),

  /**
   * Kontak yang otomatis jadi admin klub, dipisah koma. Tanpa ini tidak ada
   * jalan menjadi admin sama sekali — pengurus pertama harus bisa masuk
   * lewat konfigurasi, bukan lewat query manual ke database.
   */
  adminContacts: (env('ADMIN_CONTACTS') ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),

  /*
   * Midtrans. Tanpa kunci ini, pembayaran memakai simulator yang menyebut
   * dirinya simulator — bukan berpura-pura menerima uang.
   */
  midtrans: {
    serverKey: env('MIDTRANS_SERVER_KEY'),
    clientKey: env('MIDTRANS_CLIENT_KEY'),
    production: env('MIDTRANS_PRODUCTION') === 'true',
  },

  google: oauth('GOOGLE'),
  facebook: oauth('FACEBOOK'),

  sms: {
    /** Twilio. Tanpa ini, OTP dicetak ke log server. */
    accountSid: env('TWILIO_ACCOUNT_SID'),
    authToken: env('TWILIO_AUTH_TOKEN'),
    from: env('TWILIO_FROM'),
  },

  smtp: {
    host: env('SMTP_HOST'),
    port: Number(env('SMTP_PORT') ?? 587),
    user: env('SMTP_USER'),
    pass: env('SMTP_PASS'),
    from: env('SMTP_FROM') ?? 'DBTC <no-reply@dbtc.id>',
  },
} as const

export function paymentsConfigured(): boolean {
  return Boolean(config.midtrans.serverKey && config.midtrans.clientKey)
}

export function smsConfigured(): boolean {
  return Boolean(config.sms.accountSid && config.sms.authToken && config.sms.from)
}

export function smtpConfigured(): boolean {
  return Boolean(config.smtp.host && config.smtp.user && config.smtp.pass)
}

/** Dipakai endpoint status supaya frontend tahu tombol mana yang layak tampil. */
export function providerStatus() {
  return {
    phone: true,
    email: true,
    google: config.google !== null,
    facebook: config.facebook !== null,
    smsDelivery: smsConfigured() ? 'twilio' : 'log',
    payments: paymentsConfigured() ? 'midtrans' : 'simulator',
    emailDelivery: smtpConfigured() ? 'smtp' : 'log',
  } as const
}

/* ── Kesiapan deploy ─────────────────────────────────────────────────────── */

export type ReadinessLevel = 'fatal' | 'warn'

export interface ReadinessIssue {
  level: ReadinessLevel
  setting: string
  message: string
}

/**
 * Memeriksa konfigurasi terhadap hal-hal yang diam-diam merusak di produksi.
 *
 * Dikembalikan sebagai daftar, bukan dilempar langsung, supaya seluruh
 * masalah terlihat sekaligus. Memperbaiki satu-satu lalu men-deploy ulang
 * untuk menemukan yang berikutnya adalah cara yang mahal untuk membaca
 * daftar ini.
 */
export function readiness(): ReadinessIssue[] {
  const issues: ReadinessIssue[] = []
  const fatal = (setting: string, message: string) =>
    issues.push({ level: 'fatal', setting, message })
  const warn = (setting: string, message: string) =>
    issues.push({ level: 'warn', setting, message })

  /*
   * Pepper bawaan berarti setiap token sesi bisa dipalsukan siapa pun yang
   * pernah membaca repositori ini. Diperiksa terhadap nilainya, bukan cuma
   * "apakah variabelnya diisi": menyalin nilai dari README ke .env tetap
   * meninggalkan pepper yang sudah publik.
   */
  if (config.tokenPepper === DEV_TOKEN_PEPPER) {
    fatal(
      'TOKEN_PEPPER',
      'Masih memakai pepper bawaan yang tertulis di repositori ini. Isi dengan nilai acak: `openssl rand -base64 48`.',
    )
  } else if (config.tokenPepper.length < MIN_PEPPER_LENGTH) {
    fatal(
      'TOKEN_PEPPER',
      `Panjangnya ${config.tokenPepper.length} karakter, minimal ${MIN_PEPPER_LENGTH}.`,
    )
  }

  /*
   * SQLite adalah satu berkas di satu mesin. Dua instance app yang menunjuk
   * berkas yang sama lewat disk jaringan akan merusaknya, dan yang menunjuk
   * berkas berbeda akan diam-diam punya dua kumpulan user.
   */
  if (!config.databaseUrl) {
    warn(
      'DATABASE_URL',
      'Memakai SQLite berkas. Cukup untuk satu instance; isi DATABASE_URL kalau app dijalankan lebih dari satu proses.',
    )
  }

  if (config.adminContacts.length === 0) {
    warn(
      'ADMIN_CONTACTS',
      'Kosong, jadi tidak ada yang bisa jadi admin klub. Isi dengan nomor atau email pengurus.',
    )
  }

  if (!smsConfigured()) {
    warn('TWILIO_*', 'Kode OTP dicetak ke log server, bukan dikirim lewat SMS.')
  }
  if (!smtpConfigured()) {
    warn('SMTP_*', 'Email verifikasi dan atur ulang sandi dicetak ke log, bukan dikirim.')
  }
  if (!paymentsConfigured()) {
    /*
     * Fatal di produksi, bukan sekadar peringatan: app yang menerima pesanan
     * dan mengaku lunas tanpa gerbang pembayaran mengambil barang orang tanpa
     * uang berpindah. Itu bukan kekurangan fitur, itu salah.
     */
    fatal(
      'MIDTRANS_*',
      'Belum ada gerbang pembayaran. Pembayaran akan memakai simulator, yang tidak menerima uang sungguhan.',
    )
  }
  if (config.appOrigin.startsWith('http://') && !config.appOrigin.includes('localhost')) {
    fatal('APP_ORIGIN', 'Bukan HTTPS. Token sesi akan melintas dalam bentuk terbaca.')
  }

  return issues
}

/**
 * Mencetak hasil pemeriksaan, dan menolak start kalau ada yang fatal **di
 * produksi**. Di luar produksi hanya diberitahukan: memblokir `npm run dev`
 * karena pepper bawaan akan membuat orang menghapus pemeriksaannya.
 */
export function assertReady(log: (message: string) => void = console.warn): void {
  const issues = readiness()
  if (issues.length === 0) {
    log('[config] Semua pemeriksaan kesiapan lolos.')
    return
  }

  for (const { level, setting, message } of issues) {
    log(`[config:${level}] ${setting} — ${message}`)
  }

  const fatals = issues.filter((i) => i.level === 'fatal')
  if (fatals.length > 0 && config.isProduction) {
    throw new Error(
      `Server menolak start: ${fatals.map((f) => f.setting).join(', ')} belum layak produksi.`,
    )
  }
}
