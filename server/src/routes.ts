import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { config, providerStatus } from './config.ts'
import { hashPassword, verifyPassword } from './crypto.ts'
import {
  attachEmail,
  attachPhone,
  checkPassword,
  consumeEmailToken,
  createSession,
  createUser,
  detachEmail,
  detachPhone,
  findUserByEmail,
  findUserById,
  findUserByIdentity,
  findUserByPhone,
  identitiesFor,
  issueEmailToken,
  issueOtp,
  linkIdentity,
  markEmailVerified,
  normaliseEmail,
  normalisePhone,
  ownerOfIdentity,
  publicUser,
  revokeAllSessions,
  revokeSession,
  setPassword,
  signInMethods,
  unlinkIdentity,
  syncRole,
  userForSession,
  verifyOtp,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
} from './auth.ts'
import {
  beginOAuth,
  exchangeCode,
  providerConfig,
  takeOAuthState,
  type ProviderName,
} from './oauth.ts'
import { sendEmail, sendSms } from './senders.ts'
import { db, type UserRow } from './db.ts'

export const routes = Router()

/* ── Bantuan ─────────────────────────────────────────────────────────────── */

function fail(res: Response, status: number, code: string, message: string, extra = {}) {
  return res.status(status).json({ code, message, ...extra })
}

function bearer(req: Request): string | null {
  const header = req.header('authorization')
  if (!header?.startsWith('Bearer ')) return null
  return header.slice(7).trim() || null
}

/** Sesi baru + bentuk balasan yang sama untuk semua metode masuk. */
function signIn(res: Response, userId: string, extra: Record<string, unknown> = {}) {
  const session = createSession(userId)
  const found = findUserById(userId)
  if (!found) return fail(res, 500, 'USER_MISSING', 'User hilang saat membuat sesi.')
  // Daftar admin bisa berubah kapan saja; peran disegarkan tiap kali masuk.
  const row = syncRole(found)
  return res.json({
    token: session.token,
    expiresAt: session.expiresAt,
    user: publicUser(row),
    identities: identitiesFor(userId),
    ...extra,
  })
}

/* ── Status penyedia ─────────────────────────────────────────────────────── */

routes.get('/providers', (_req, res) => {
  res.json(providerStatus())
})

/* ── Masuk dengan nomor HP ───────────────────────────────────────────────── */

const phoneSchema = z.object({ phone: z.string().min(1) })

routes.post('/phone/request-otp', async (req, res) => {
  const parsed = phoneSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 422, 'INVALID_BODY', 'Nomor HP wajib diisi.')

  const phone = normalisePhone(parsed.data.phone)
  if (!phone) {
    return fail(res, 422, 'INVALID_PHONE', 'Nomor HP tidak valid. Contoh: 0812 8845 1190.')
  }

  const issued = issueOtp(phone)
  if (!issued.ok) {
    const message =
      issued.reason === 'cooldown'
        ? `Tunggu ${issued.retryAfterSeconds} detik sebelum minta kode lagi.`
        : 'Terlalu banyak permintaan kode. Coba lagi satu jam lagi.'
    return fail(res, 429, issued.reason === 'cooldown' ? 'COOLDOWN' : 'RATE_LIMIT', message, {
      retryAfterSeconds: issued.retryAfterSeconds,
    })
  }

  const delivery = await sendSms(
    phone,
    `Kode masuk DBTC kamu: ${issued.code}. Berlaku 5 menit. Jangan berikan ke siapa pun.`,
  )

  res.json({
    phone,
    expiresAt: issued.expiresAt,
    resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    delivery: delivery.channel,
    /*
     * Di luar produksi, kode ikut dikembalikan supaya alurnya bisa
     * diselesaikan tanpa penyedia SMS. Di produksi ini tidak pernah ada —
     * mengembalikan OTP lewat API sama saja meniadakan gunanya.
     */
    ...(config.isProduction ? {} : { devCode: issued.code }),
  })
})

const verifySchema = z.object({
  phone: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, 'Kode terdiri dari 6 angka.'),
  name: z.string().trim().min(1).max(80).optional(),
})

routes.post('/phone/verify-otp', (req, res) => {
  const parsed = verifySchema.safeParse(req.body)
  if (!parsed.success) {
    return fail(res, 422, 'INVALID_BODY', parsed.error.issues[0]?.message ?? 'Data tidak valid.')
  }

  const phone = normalisePhone(parsed.data.phone)
  if (!phone) return fail(res, 422, 'INVALID_PHONE', 'Nomor HP tidak valid.')

  const check = verifyOtp(phone, parsed.data.code)
  if (!check.ok) {
    const messages: Record<typeof check.reason, string> = {
      notFound: 'Belum ada kode aktif untuk nomor ini. Minta kode baru.',
      expired: 'Kode sudah kedaluwarsa. Minta kode baru.',
      tooManyAttempts: `Kode dikunci setelah ${OTP_MAX_ATTEMPTS} kali salah. Minta kode baru.`,
      wrong: `Kode salah. Sisa ${check.attemptsLeft} percobaan.`,
    }
    return fail(
      res,
      check.reason === 'wrong' ? 422 : 410,
      check.reason.toUpperCase(),
      messages[check.reason],
      {
        attemptsLeft: check.attemptsLeft,
      },
    )
  }

  const existing = findUserByPhone(phone)
  const user =
    existing ??
    createUser({ name: parsed.data.name?.trim() || 'Anggota', phone, phoneVerified: true })
  if (existing && existing.phone_verified === 0) {
    db.prepare('UPDATE users SET phone_verified = 1 WHERE id = ?').run(existing.id)
  }
  return signIn(res, user.id)
})

/* ── Daftar & masuk dengan email ─────────────────────────────────────────── */

const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().min(1),
  password: z.string().min(1),
})

routes.post('/email/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) {
    return fail(res, 422, 'INVALID_BODY', parsed.error.issues[0]?.message ?? 'Data tidak lengkap.')
  }

  const email = normaliseEmail(parsed.data.email)
  if (!email) return fail(res, 422, 'INVALID_EMAIL', 'Format email tidak valid.')

  const problem = checkPassword(parsed.data.password)
  if (problem) return fail(res, 422, 'WEAK_PASSWORD', problem.message)

  if (findUserByEmail(email)) {
    return fail(res, 409, 'EMAIL_TAKEN', 'Email ini sudah terdaftar. Masuk saja.')
  }

  const user = createUser({
    name: parsed.data.name,
    email,
    passwordHash: await hashPassword(parsed.data.password),
  })

  const token = issueEmailToken(user.id, 'verify')
  const delivery = await sendEmail(
    email,
    'Verifikasi email DBTC',
    `Halo ${user.name},\n\nMasukkan kode ini di app untuk memverifikasi email kamu:\n\n${token}\n\nBerlaku 24 jam.`,
  )

  // Akun langsung bisa dipakai; verifikasi email menyusul, bukan penghalang.
  return signIn(res, user.id, {
    delivery: delivery.channel,
    ...(config.isProduction ? {} : { devToken: token }),
  })
})

const loginSchema = z.object({ email: z.string().min(1), password: z.string().min(1) })

routes.post('/email/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 422, 'INVALID_BODY', 'Email dan kata sandi wajib diisi.')

  const email = normaliseEmail(parsed.data.email)
  const user = email ? findUserByEmail(email) : undefined

  /*
   * Satu pesan yang sama untuk email tidak terdaftar maupun sandi salah.
   * Membedakan keduanya memberi tahu penyerang alamat mana yang terdaftar.
   */
  const wrong = () => fail(res, 401, 'BAD_CREDENTIALS', 'Email atau kata sandi salah.')

  if (!user || !user.password_hash) return wrong()
  if (!(await verifyPassword(parsed.data.password, user.password_hash))) return wrong()

  return signIn(res, user.id)
})

const emailTokenSchema = z.object({ token: z.string().min(1) })

routes.post('/email/verify', (req, res) => {
  const parsed = emailTokenSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 422, 'INVALID_BODY', 'Token wajib diisi.')

  const user = consumeEmailToken(parsed.data.token, 'verify')
  if (!user) return fail(res, 410, 'TOKEN_INVALID', 'Tautan verifikasi tidak berlaku lagi.')

  markEmailVerified(user.id)
  res.json({ ok: true, user: publicUser({ ...user, email_verified: 1 }) })
})

routes.post('/email/resend-verification', async (req, res) => {
  const token = bearer(req)
  const user = token ? userForSession(token) : undefined
  if (!user) return fail(res, 401, 'UNAUTHENTICATED', 'Masuk dulu.')
  if (!user.email) return fail(res, 422, 'NO_EMAIL', 'Akun ini belum punya email.')
  if (user.email_verified === 1) {
    return fail(res, 409, 'ALREADY_VERIFIED', 'Email kamu sudah terverifikasi.')
  }

  const fresh = issueEmailToken(user.id, 'verify')
  const delivery = await sendEmail(
    user.email,
    'Verifikasi email DBTC',
    `Kode verifikasi kamu:\n\n${fresh}\n\nBerlaku 24 jam.`,
  )
  res.json({
    ok: true,
    delivery: delivery.channel,
    ...(config.isProduction ? {} : { devToken: fresh }),
  })
})

/* ── OAuth ───────────────────────────────────────────────────────────────── */

function providerName(value: string): ProviderName | null {
  return value === 'google' || value === 'facebook' ? value : null
}

routes.get('/oauth/:provider/start', (req, res) => {
  const name = providerName(req.params.provider)
  if (!name) return fail(res, 404, 'UNKNOWN_PROVIDER', 'Penyedia tidak dikenal.')

  if (!providerConfig(name)) {
    return fail(
      res,
      501,
      'PROVIDER_NOT_CONFIGURED',
      `Masuk dengan ${name} belum dikonfigurasi di server ini. ` +
        `Isi ${name.toUpperCase()}_CLIENT_ID dan ${name.toUpperCase()}_CLIENT_SECRET.`,
    )
  }

  const started = beginOAuth(name)
  if (!started) return fail(res, 500, 'OAUTH_START_FAILED', 'Gagal memulai alur OAuth.')
  res.redirect(started.url)
})

routes.get('/oauth/:provider/callback', async (req, res) => {
  const name = providerName(req.params.provider)
  if (!name) return fail(res, 404, 'UNKNOWN_PROVIDER', 'Penyedia tidak dikenal.')

  /*
   * Putaran menyambung kembali ke Profil, bukan ke Login: orangnya memang
   * sudah masuk, dan melemparnya ke layar login akan tampak seperti sesinya
   * hilang justru setelah ia menambah cara masuk.
   */
  const back = (params: Record<string, string>) => {
    const linking = 'linked' in params || typeof params.link === 'string'
    const path = linking ? '/profile' : '/login'
    return res.redirect(`${config.appOrigin}${path}?${new URLSearchParams(params).toString()}`)
  }

  if (typeof req.query.error === 'string') return back({ error: req.query.error })

  const code = typeof req.query.code === 'string' ? req.query.code : null
  const state = typeof req.query.state === 'string' ? req.query.state : null
  if (!code || !state) return back({ error: 'missing_code' })

  const stored = takeOAuthState(state)
  // State tidak cocok berarti balasan ini bukan milik permintaan kita.
  if (!stored || stored.provider !== name) return back({ error: 'bad_state' })

  try {
    const profile = await exchangeCode(name, code, stored.code_verifier)
    const email = profile.email ? normaliseEmail(profile.email) : null

    /*
     * Putaran menyambung: akunnya sudah ditentukan sebelum pengguna pergi ke
     * penyedia, jadi tidak ada akun baru yang dibuat dan tidak ada sesi baru
     * yang diterbitkan — sesi yang sedang berjalan tetap yang berlaku.
     */
    if (stored.link_user_id) {
      const target = findUserById(stored.link_user_id)
      if (!target) return back({ error: 'link_user_missing', link: name })

      const owner = ownerOfIdentity(name, profile.subject)
      if (owner && owner !== target.id) {
        // Satu akun penyedia tidak boleh menempel di dua akun DBTC.
        return back({ error: 'provider_taken', link: name })
      }

      linkIdentity(target.id, name, profile.subject, email)
      return back({ linked: name })
    }

    let user = findUserByIdentity(name, profile.subject)
    if (!user && email) {
      // Email yang sama dianggap orang yang sama, lalu identitasnya ditautkan.
      const byEmail = findUserByEmail(email)
      if (byEmail) {
        linkIdentity(byEmail.id, name, profile.subject, email)
        user = byEmail
      }
    }
    if (!user) {
      user = createUser({ name: profile.name, email, emailVerified: Boolean(email) })
      linkIdentity(user.id, name, profile.subject, email)
    }

    const session = createSession(user.id)
    return back({ token: session.token })
  } catch (error) {
    console.error(`[oauth:${name}]`, error)
    return back({ error: 'exchange_failed' })
  }
})

/* ── Lupa & atur ulang kata sandi ────────────────────────────────────────── */

const forgotSchema = z.object({ email: z.string().min(1) })

/**
 * Balasannya selalu sama, terdaftar atau tidak.
 *
 * Membedakan "email tidak ada" dari "tautan terkirim" mengubah endpoint ini
 * jadi alat untuk memeriksa alamat mana yang punya akun di sini — dan itu
 * bisa dilakukan siapa saja, tanpa masuk.
 */
routes.post('/password/forgot', async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 422, 'INVALID_BODY', 'Email wajib diisi.')

  const same = {
    ok: true,
    message: 'Kalau email itu terdaftar, kami sudah mengirim kode atur ulang.',
  }

  const email = normaliseEmail(parsed.data.email)
  const user = email ? findUserByEmail(email) : undefined
  if (!user) return res.json(same)

  const token = issueEmailToken(user.id, 'reset')
  const delivery = await sendEmail(
    user.email!,
    'Atur ulang kata sandi DBTC',
    `Halo ${user.name},\n\nMasukkan kode ini di app untuk membuat kata sandi baru:\n\n${token}\n\n` +
      `Berlaku 24 jam. Kalau bukan kamu yang meminta, abaikan saja — kata sandi lama tetap berlaku.`,
  )

  return res.json({
    ...same,
    delivery: delivery.channel,
    ...(config.isProduction ? {} : { devToken: token }),
  })
})

const resetSchema = z.object({ token: z.string().min(1), password: z.string().min(1) })

routes.post('/password/reset', async (req, res) => {
  const parsed = resetSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 422, 'INVALID_BODY', 'Token dan kata sandi wajib diisi.')

  const problem = checkPassword(parsed.data.password)
  if (problem) return fail(res, 422, 'WEAK_PASSWORD', problem.message)

  // Token diperiksa setelah sandinya, supaya sandi lemah tidak menghanguskan
  // token sekali-pakai dan memaksa orang meminta kode baru.
  const user = consumeEmailToken(parsed.data.token, 'reset')
  if (!user) return fail(res, 410, 'TOKEN_INVALID', 'Kode atur ulang tidak berlaku lagi.')

  setPassword(user.id, await hashPassword(parsed.data.password))
  /*
   * Semua sesi lama dicabut. Kalau tidak, siapa pun yang sudah masuk dengan
   * sandi lama tetap masuk — dan mengatur ulang sandi tidak menyelesaikan
   * apa pun bagi orang yang akunnya diambil alih.
   */
  const revoked = revokeAllSessions(user.id)

  // Email yang bisa menerima kode itu terbukti dimiliki orang yang sama.
  if (user.email_verified === 0) markEmailVerified(user.id)

  return signIn(res, user.id, { revokedSessions: revoked })
})

/* ── Menyambungkan cara masuk ke akun yang sama ──────────────────────────── */

/** Middleware kecil: rute di bawah ini semua butuh sesi. */
function requireUser(req: Request, res: Response): UserRow | null {
  const token = bearer(req)
  const user = token ? userForSession(token) : undefined
  if (!user) {
    fail(res, 401, 'UNAUTHENTICATED', 'Masuk dulu.')
    return null
  }
  return user
}

function linkState(user: UserRow) {
  return {
    methods: signInMethods(user),
    user: publicUser(user),
    identities: identitiesFor(user.id),
  }
}

routes.get('/link', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return
  res.json(linkState(user))
})

routes.post('/link/phone/request-otp', async (req, res) => {
  const user = requireUser(req, res)
  if (!user) return

  const parsed = phoneSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 422, 'INVALID_BODY', 'Nomor HP wajib diisi.')

  const phone = normalisePhone(parsed.data.phone)
  if (!phone) return fail(res, 422, 'INVALID_PHONE', 'Nomor HP tidak valid.')

  /*
   * Nomor yang sudah dipakai akun lain ditolak, bukan dipindahkan diam-diam.
   * Menggabungkan dua akun berarti memutuskan booking dan poin siapa yang
   * bertahan — keputusan itu bukan milik endpoint ini.
   */
  const owner = findUserByPhone(phone)
  if (owner && owner.id !== user.id) {
    return fail(
      res,
      409,
      'PHONE_TAKEN',
      'Nomor ini sudah dipakai akun lain. Masuk dengan nomor itu, atau hubungi klub untuk menggabungkan akun.',
    )
  }
  if (owner) return fail(res, 409, 'ALREADY_LINKED', 'Nomor ini sudah tersambung ke akunmu.')

  const issued = issueOtp(phone)
  if (!issued.ok) {
    return fail(
      res,
      429,
      issued.reason === 'cooldown' ? 'COOLDOWN' : 'RATE_LIMIT',
      issued.reason === 'cooldown'
        ? `Tunggu ${issued.retryAfterSeconds} detik sebelum minta kode lagi.`
        : 'Terlalu banyak permintaan kode. Coba lagi satu jam lagi.',
      { retryAfterSeconds: issued.retryAfterSeconds },
    )
  }

  const delivery = await sendSms(
    phone,
    `Kode untuk menyambungkan nomor ini ke akun DBTC kamu: ${issued.code}. Berlaku 5 menit.`,
  )

  res.json({
    phone,
    expiresAt: issued.expiresAt,
    resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    delivery: delivery.channel,
    ...(config.isProduction ? {} : { devCode: issued.code }),
  })
})

routes.post('/link/phone/verify', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return

  const parsed = verifySchema.safeParse(req.body)
  if (!parsed.success) {
    return fail(res, 422, 'INVALID_BODY', parsed.error.issues[0]?.message ?? 'Data tidak valid.')
  }

  const phone = normalisePhone(parsed.data.phone)
  if (!phone) return fail(res, 422, 'INVALID_PHONE', 'Nomor HP tidak valid.')

  // Diperiksa lagi: nomornya bisa saja diklaim akun lain sejak kode dikirim.
  const owner = findUserByPhone(phone)
  if (owner && owner.id !== user.id) {
    return fail(res, 409, 'PHONE_TAKEN', 'Nomor ini sudah dipakai akun lain.')
  }

  const check = verifyOtp(phone, parsed.data.code)
  if (!check.ok) {
    return fail(
      res,
      check.reason === 'wrong' ? 422 : 410,
      check.reason.toUpperCase(),
      check.reason === 'wrong'
        ? `Kode salah. Sisa ${check.attemptsLeft} percobaan.`
        : 'Kode sudah tidak berlaku. Minta kode baru.',
      { attemptsLeft: check.attemptsLeft },
    )
  }

  attachPhone(user.id, phone)
  const fresh = syncRole(findUserById(user.id)!)
  res.json(linkState(fresh))
})

const linkEmailSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1).optional(),
})

routes.post('/link/email', async (req, res) => {
  const user = requireUser(req, res)
  if (!user) return

  const parsed = linkEmailSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 422, 'INVALID_BODY', 'Email wajib diisi.')

  const email = normaliseEmail(parsed.data.email)
  if (!email) return fail(res, 422, 'INVALID_EMAIL', 'Format email tidak valid.')

  const owner = findUserByEmail(email)
  if (owner && owner.id !== user.id) {
    return fail(res, 409, 'EMAIL_TAKEN', 'Email ini sudah dipakai akun lain.')
  }

  /*
   * Sandi wajib kalau akun ini belum punya. Email tanpa sandi tidak menambah
   * satu pun cara masuk — layar mana pun tetap meminta sandi — jadi
   * menerimanya berarti menjanjikan sesuatu yang tidak diberikan.
   */
  let passwordHash: string | null = null
  if (parsed.data.password) {
    const problem = checkPassword(parsed.data.password)
    if (problem) return fail(res, 422, 'WEAK_PASSWORD', problem.message)
    passwordHash = await hashPassword(parsed.data.password)
  } else if (!user.password_hash) {
    return fail(
      res,
      422,
      'PASSWORD_REQUIRED',
      'Buat kata sandi juga — email saja belum bisa dipakai untuk masuk.',
    )
  }

  attachEmail(user.id, email, passwordHash)

  const token = issueEmailToken(user.id, 'verify')
  const delivery = await sendEmail(
    email,
    'Verifikasi email DBTC',
    `Masukkan kode ini di app untuk memverifikasi email kamu:\n\n${token}\n\nBerlaku 24 jam.`,
  )

  const fresh = syncRole(findUserById(user.id)!)
  res.json({
    ...linkState(fresh),
    delivery: delivery.channel,
    ...(config.isProduction ? {} : { devToken: token }),
  })
})

/** Memulai OAuth untuk menyambung, bukan untuk masuk. */
routes.get('/link/:provider/start', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return

  const name = providerName(req.params.provider)
  if (!name) return fail(res, 404, 'UNKNOWN_PROVIDER', 'Penyedia tidak dikenal.')
  if (!providerConfig(name)) {
    return fail(
      res,
      501,
      'PROVIDER_NOT_CONFIGURED',
      `Masuk dengan ${name} belum dikonfigurasi di server ini.`,
    )
  }

  const started = beginOAuth(name, user.id)
  if (!started) return fail(res, 500, 'OAUTH_START_FAILED', 'Gagal memulai alur OAuth.')
  // URL dikembalikan, bukan di-redirect: permintaan ini bawa header
  // Authorization, dan redirect akan kehilangan header itu.
  res.json({ url: started.url })
})

const UNLINKABLE = ['phone', 'email', 'google', 'facebook'] as const
type Unlinkable = (typeof UNLINKABLE)[number]

routes.delete('/link/:method', (req, res) => {
  const user = requireUser(req, res)
  if (!user) return

  const method = req.params.method as Unlinkable
  if (!UNLINKABLE.includes(method)) {
    return fail(res, 404, 'UNKNOWN_METHOD', 'Cara masuk tidak dikenal.')
  }

  const methods = signInMethods(user)
  if (!methods.includes(method)) {
    return fail(res, 409, 'NOT_LINKED', 'Cara masuk itu belum tersambung ke akunmu.')
  }
  /*
   * Selalu sisakan satu. Melepas yang terakhir mengunci orang keluar dari
   * akunnya sendiri secara permanen — tidak ada layar pemulihan yang bisa
   * menolong akun tanpa satu pun cara masuk.
   */
  if (methods.length <= 1) {
    return fail(
      res,
      409,
      'LAST_METHOD',
      'Ini satu-satunya cara masuk ke akunmu. Sambungkan cara lain dulu sebelum melepasnya.',
    )
  }

  if (method === 'phone') detachPhone(user.id)
  else if (method === 'email') detachEmail(user.id)
  else unlinkIdentity(user.id, method)

  const fresh = syncRole(findUserById(user.id)!)
  res.json(linkState(fresh))
})

/* ── Sesi ────────────────────────────────────────────────────────────────── */

routes.get('/me', (req, res) => {
  const token = bearer(req)
  const user = token ? userForSession(token) : undefined
  if (!user) return fail(res, 401, 'UNAUTHENTICATED', 'Sesi tidak berlaku.')
  const fresh = syncRole(user)
  res.json({ user: publicUser(fresh), identities: identitiesFor(fresh.id) })
})

routes.post('/logout', (req, res) => {
  const token = bearer(req)
  if (token) revokeSession(token)
  // Keluar selalu berhasil dari sudut pandang pemanggil.
  res.json({ ok: true })
})
