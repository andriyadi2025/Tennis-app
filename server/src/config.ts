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

  /**
   * Kunci untuk mem-hash token sesi sebelum disimpan. Bukan untuk JWT —
   * sesi di sini bersifat opaque dan bisa dicabut, yang lebih aman daripada
   * token bertanda tangan yang tidak bisa ditarik sebelum kedaluwarsa.
   */
  tokenPepper: required('TOKEN_PEPPER', 'pepper-pengembangan-jangan-dipakai-produksi'),

  /**
   * Kontak yang otomatis jadi admin klub, dipisah koma. Tanpa ini tidak ada
   * jalan menjadi admin sama sekali — pengurus pertama harus bisa masuk
   * lewat konfigurasi, bukan lewat query manual ke database.
   */
  adminContacts: (env('ADMIN_CONTACTS') ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),

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
    emailDelivery: smtpConfigured() ? 'smtp' : 'log',
  } as const
}
