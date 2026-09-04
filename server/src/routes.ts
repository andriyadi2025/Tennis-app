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
  mergeAuthData,
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
import {
  countSubscriptions,
  publicKey,
  pushConfigured,
  removeSubscription,
  saveSubscription,
  sendPush,
} from './push.ts'
import { mergeDomainData, mergePreview } from './domain/store.ts'

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
async function signIn(res: Response, userId: string, extra: Record<string, unknown> = {}) {
  const session = await createSession(userId)
  const found = await findUserById(userId)
  if (!found) return fail(res, 500, 'USER_MISSING', 'User hilang saat membuat sesi.')
  // Daftar admin bisa berubah kapan saja; peran disegarkan tiap kali masuk.
  const row = await syncRole(found)
  return res.json({
    token: session.token,
    expiresAt: session.expiresAt,
    user: publicUser(row),
    identities: await identitiesFor(userId),
    ...extra,
  })
}

/* ── Status penyedia ─────────────────────────────────────────────────────── */

routes.get('/providers', async (_req, res) => {
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

  const issued = await issueOtp(phone)
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

routes.post('/phone/verify-otp', async (req, res) => {
  const parsed = verifySchema.safeParse(req.body)
  if (!parsed.success) {
    return fail(res, 422, 'INVALID_BODY', parsed.error.issues[0]?.message ?? 'Data tidak valid.')
  }

  const phone = normalisePhone(parsed.data.phone)
  if (!phone) return fail(res, 422, 'INVALID_PHONE', 'Nomor HP tidak valid.')

  const check = await verifyOtp(phone, parsed.data.code)
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

  const existing = await findUserByPhone(phone)
  const user =
    existing ??
    (await createUser({ name: parsed.data.name?.trim() || 'Anggota', phone, phoneVerified: true }))
  if (existing && existing.phone_verified === 0) {
    await db.run('UPDATE users SET phone_verified = 1 WHERE id = ?', [existing.id])
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

  if (await findUserByEmail(email)) {
    return fail(res, 409, 'EMAIL_TAKEN', 'Email ini sudah terdaftar. Masuk saja.')
  }

  const user = await createUser({
    name: parsed.data.name,
    email,
    passwordHash: await hashPassword(parsed.data.password),
  })

  const token = await issueEmailToken(user.id, 'verify')
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
  const user = email ? await findUserByEmail(email) : undefined

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

routes.post('/email/verify', async (req, res) => {
  const parsed = emailTokenSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 422, 'INVALID_BODY', 'Token wajib diisi.')

  const user = await consumeEmailToken(parsed.data.token, 'verify')
  if (!user) return fail(res, 410, 'TOKEN_INVALID', 'Tautan verifikasi tidak berlaku lagi.')

  await markEmailVerified(user.id)
  res.json({ ok: true, user: publicUser({ ...user, email_verified: 1 }) })
})

routes.post('/email/resend-verification', async (req, res) => {
  const token = bearer(req)
  const user = token ? await userForSession(token) : undefined
  if (!user) return fail(res, 401, 'UNAUTHENTICATED', 'Masuk dulu.')
  if (!user.email) return fail(res, 422, 'NO_EMAIL', 'Akun ini belum punya email.')
  if (user.email_verified === 1) {
    return fail(res, 409, 'ALREADY_VERIFIED', 'Email kamu sudah terverifikasi.')
  }

  const fresh = await issueEmailToken(user.id, 'verify')
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

routes.get('/oauth/:provider/start', async (req, res) => {
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

  const started = await beginOAuth(name)
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

  const stored = await takeOAuthState(state)
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
      const target = await findUserById(stored.link_user_id)
      if (!target) return back({ error: 'link_user_missing', link: name })

      const owner = await ownerOfIdentity(name, profile.subject)
      if (owner && owner !== target.id) {
        // Satu akun penyedia tidak boleh menempel di dua akun DBTC.
        return back({ error: 'provider_taken', link: name })
      }

      await linkIdentity(target.id, name, profile.subject, email)
      return back({ linked: name })
    }

    let user = await findUserByIdentity(name, profile.subject)
    if (!user && email) {
      // Email yang sama dianggap orang yang sama, lalu identitasnya ditautkan.
      const byEmail = await findUserByEmail(email)
      if (byEmail) {
        await linkIdentity(byEmail.id, name, profile.subject, email)
        user = byEmail
      }
    }
    if (!user) {
      user = await createUser({ name: profile.name, email, emailVerified: Boolean(email) })
      await linkIdentity(user.id, name, profile.subject, email)
    }

    const session = await createSession(user.id)
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
  const user = email ? await findUserByEmail(email) : undefined
  if (!user) return res.json(same)

  const token = await issueEmailToken(user.id, 'reset')
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
  const user = await consumeEmailToken(parsed.data.token, 'reset')
  if (!user) return fail(res, 410, 'TOKEN_INVALID', 'Kode atur ulang tidak berlaku lagi.')

  await setPassword(user.id, await hashPassword(parsed.data.password))
  /*
   * Semua sesi lama dicabut. Kalau tidak, siapa pun yang sudah masuk dengan
   * sandi lama tetap masuk — dan mengatur ulang sandi tidak menyelesaikan
   * apa pun bagi orang yang akunnya diambil alih.
   */
  const revoked = await revokeAllSessions(user.id)

  // Email yang bisa menerima kode itu terbukti dimiliki orang yang sama.
  if (user.email_verified === 0) await markEmailVerified(user.id)

  return signIn(res, user.id, { revokedSessions: revoked })
})

/* ── Menyambungkan cara masuk ke akun yang sama ──────────────────────────── */

/** Middleware kecil: rute di bawah ini semua butuh sesi. */
async function requireUser(req: Request, res: Response): Promise<UserRow | null> {
  const token = bearer(req)
  const user = token ? await userForSession(token) : undefined
  if (!user) {
    fail(res, 401, 'UNAUTHENTICATED', 'Masuk dulu.')
    return null
  }
  return user
}

async function linkState(user: UserRow) {
  return {
    methods: await signInMethods(user),
    user: publicUser(user),
    identities: await identitiesFor(user.id),
  }
}

routes.get('/link', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  res.json(await linkState(user))
})

routes.post('/link/phone/request-otp', async (req, res) => {
  const user = await requireUser(req, res)
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
  const owner = await findUserByPhone(phone)
  if (owner && owner.id !== user.id) {
    return fail(
      res,
      409,
      'PHONE_TAKEN',
      'Nomor ini sudah dipakai akun lain. Masuk dengan nomor itu, atau hubungi klub untuk menggabungkan akun.',
    )
  }
  if (owner) return fail(res, 409, 'ALREADY_LINKED', 'Nomor ini sudah tersambung ke akunmu.')

  const issued = await issueOtp(phone)
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

routes.post('/link/phone/verify', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return

  const parsed = verifySchema.safeParse(req.body)
  if (!parsed.success) {
    return fail(res, 422, 'INVALID_BODY', parsed.error.issues[0]?.message ?? 'Data tidak valid.')
  }

  const phone = normalisePhone(parsed.data.phone)
  if (!phone) return fail(res, 422, 'INVALID_PHONE', 'Nomor HP tidak valid.')

  // Diperiksa lagi: nomornya bisa saja diklaim akun lain sejak kode dikirim.
  const owner = await findUserByPhone(phone)
  if (owner && owner.id !== user.id) {
    return fail(res, 409, 'PHONE_TAKEN', 'Nomor ini sudah dipakai akun lain.')
  }

  const check = await verifyOtp(phone, parsed.data.code)
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

  await attachPhone(user.id, phone)
  const fresh = await syncRole((await findUserById(user.id))!)
  res.json(await linkState(fresh))
})

const linkEmailSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1).optional(),
})

routes.post('/link/email', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return

  const parsed = linkEmailSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 422, 'INVALID_BODY', 'Email wajib diisi.')

  const email = normaliseEmail(parsed.data.email)
  if (!email) return fail(res, 422, 'INVALID_EMAIL', 'Format email tidak valid.')

  const owner = await findUserByEmail(email)
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

  await attachEmail(user.id, email, passwordHash)

  const token = await issueEmailToken(user.id, 'verify')
  const delivery = await sendEmail(
    email,
    'Verifikasi email DBTC',
    `Masukkan kode ini di app untuk memverifikasi email kamu:\n\n${token}\n\nBerlaku 24 jam.`,
  )

  const fresh = await syncRole((await findUserById(user.id))!)
  res.json({
    ...(await linkState(fresh)),
    delivery: delivery.channel,
    ...(config.isProduction ? {} : { devToken: token }),
  })
})

/** Memulai OAuth untuk menyambung, bukan untuk masuk. */
routes.get('/link/:provider/start', async (req, res) => {
  const user = await requireUser(req, res)
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

  const started = await beginOAuth(name, user.id)
  if (!started) return fail(res, 500, 'OAUTH_START_FAILED', 'Gagal memulai alur OAuth.')
  // URL dikembalikan, bukan di-redirect: permintaan ini bawa header
  // Authorization, dan redirect akan kehilangan header itu.
  res.json({ url: started.url })
})

const UNLINKABLE = ['phone', 'email', 'google', 'facebook'] as const
type Unlinkable = (typeof UNLINKABLE)[number]

routes.delete('/link/:method', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return

  const method = req.params.method as Unlinkable
  if (!UNLINKABLE.includes(method)) {
    return fail(res, 404, 'UNKNOWN_METHOD', 'Cara masuk tidak dikenal.')
  }

  const methods = await signInMethods(user)
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

  if (method === 'phone') await detachPhone(user.id)
  else if (method === 'email') await detachEmail(user.id)
  else await unlinkIdentity(user.id, method)

  const fresh = await syncRole((await findUserById(user.id))!)
  res.json(await linkState(fresh))
})

/* ── Menggabungkan dua akun yang terlanjur terpisah ──────────────────────── */

/**
 * Orang yang mendaftar lewat nomor lalu mendaftar lagi lewat email berakhir
 * dengan dua akun, masing-masing membawa booking dan poinnya sendiri.
 * Menyambungkan kontak tidak bisa menolongnya — kontaknya sudah dipakai akun
 * lain — jadi jalannya adalah menggabungkan keduanya.
 *
 * Yang membuktikan kedua akun milik orang yang sama tetap sama seperti di
 * mana pun: kode ke kontak itu. Tidak ada jalan pintas lewat "saya yakin ini
 * akun saya".
 */
routes.post('/merge/request-otp', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return

  const parsed = phoneSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 422, 'INVALID_BODY', 'Nomor HP wajib diisi.')

  const phone = normalisePhone(parsed.data.phone)
  if (!phone) return fail(res, 422, 'INVALID_PHONE', 'Nomor HP tidak valid.')

  const owner = await findUserByPhone(phone)
  if (!owner) {
    return fail(
      res,
      404,
      'NO_SUCH_ACCOUNT',
      'Tidak ada akun lain dengan nomor itu. Kalau nomornya memang belum dipakai, sambungkan saja lewat Atur cara masuk.',
    )
  }
  if (owner.id === user.id) {
    return fail(res, 409, 'SAME_ACCOUNT', 'Nomor itu sudah ada di akun ini.')
  }

  /*
   * Slot diperiksa **sebelum** kode dikirim. Menemukan bahwa nomornya tidak
   * punya tempat setelah orangnya membuka SMS dan mengetik enam angka adalah
   * cara yang buruk untuk menyampaikan syarat yang sudah diketahui sejak awal.
   */
  if (user.phone) {
    return fail(
      res,
      409,
      'SLOT_TAKEN',
      'Akun ini sudah punya nomor HP. Lepas dulu nomor lamanya di Atur cara masuk, baru gabungkan.',
    )
  }

  const issued = await issueOtp(phone)
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
    `Kode untuk menggabungkan akun DBTC: ${issued.code}. Berlaku 5 menit. Jangan berikan ke siapa pun.`,
  )

  res.json({
    phone,
    expiresAt: issued.expiresAt,
    delivery: delivery.channel,
    /*
     * Yang dilihat pemilik akun tujuan sebelum memutuskan: apa saja yang akan
     * pindah. Menggabungkan akun tidak bisa dibatalkan, jadi angkanya
     * ditunjukkan lebih dulu.
     */
    preview: await mergePreview(owner.id),
    ...(config.isProduction ? {} : { devCode: issued.code }),
  })
})

const mergeSchema = z.object({
  phone: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, 'Kode terdiri dari 6 angka.'),
})

routes.post('/merge/confirm', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return

  const parsed = mergeSchema.safeParse(req.body)
  if (!parsed.success) {
    return fail(res, 422, 'INVALID_BODY', parsed.error.issues[0]?.message ?? 'Data tidak valid.')
  }

  const phone = normalisePhone(parsed.data.phone)
  if (!phone) return fail(res, 422, 'INVALID_PHONE', 'Nomor HP tidak valid.')

  // Diperiksa ulang: keadaannya bisa berubah antara kode dikirim dan dijawab.
  const owner = await findUserByPhone(phone)
  if (!owner) return fail(res, 404, 'NO_SUCH_ACCOUNT', 'Akun dengan nomor itu sudah tidak ada.')
  if (owner.id === user.id)
    return fail(res, 409, 'SAME_ACCOUNT', 'Nomor itu sudah ada di akun ini.')
  if (user.phone) {
    return fail(res, 409, 'SLOT_TAKEN', 'Akun ini sudah punya nomor HP. Lepas dulu nomor lamanya.')
  }

  const check = await verifyOtp(phone, parsed.data.code)
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

  /*
   * Data domain dipindah lebih dulu, baru akunnya dihapus. Urutan sebaliknya
   * akan menyisakan booking dan poin yang menunjuk user yang sudah tidak ada.
   */
  const domain = await mergeDomainData(owner.id, user.id)
  const contacts = await mergeAuthData(owner.id, user.id)

  const fresh = await syncRole((await findUserById(user.id))!)
  res.json({
    ok: true,
    user: publicUser(fresh),
    identities: await identitiesFor(fresh.id),
    methods: await signInMethods(fresh),
    merged: { ...domain, contacts },
  })
})

/* ── Notifikasi push ─────────────────────────────────────────────────────── */

/**
 * Kunci publik VAPID, dibutuhkan peramban untuk berlangganan.
 *
 * Kunci privat tidak pernah meninggalkan server. Kalau belum dikonfigurasi,
 * dijawab `available: false` — layar akan mengatakannya apa adanya alih-alih
 * menampilkan tombol yang tidak akan pernah bekerja.
 */
routes.get('/push/key', (_req, res) => {
  res.json({ available: pushConfigured(), publicKey: publicKey() })
})

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
})

routes.post('/push/subscribe', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  if (!pushConfigured()) {
    return fail(
      res,
      501,
      'PUSH_NOT_CONFIGURED',
      'Notifikasi push belum dikonfigurasi di server ini.',
    )
  }

  const parsed = subscribeSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 422, 'INVALID_BODY', 'Data langganan tidak lengkap.')

  await saveSubscription(user.id, parsed.data, req.header('user-agent') ?? null)
  res.json({ ok: true, devices: await countSubscriptions(user.id) })
})

routes.delete('/push/subscribe', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const endpoint = typeof req.query.endpoint === 'string' ? req.query.endpoint : null
  if (!endpoint) return fail(res, 422, 'INVALID_BODY', 'Endpoint wajib disebut.')
  await removeSubscription(endpoint)
  res.json({ ok: true, devices: await countSubscriptions(user.id) })
})

/** Kiriman percobaan, supaya orang bisa membuktikan sendiri push-nya sampai. */
routes.post('/push/test', async (req, res) => {
  const user = await requireUser(req, res)
  if (!user) return
  const result = await sendPush(user.id, {
    title: 'Notifikasi DBTC aktif',
    body: 'Kalau kamu melihat ini, push di perangkat ini sudah jalan.',
    href: '/notifications',
    tag: 'uji-push',
  })
  res.json(result)
})

/* ── Sesi ────────────────────────────────────────────────────────────────── */

routes.get('/me', async (req, res) => {
  const token = bearer(req)
  const user = token ? await userForSession(token) : undefined
  if (!user) return fail(res, 401, 'UNAUTHENTICATED', 'Sesi tidak berlaku.')
  const fresh = await syncRole(user)
  res.json({ user: publicUser(fresh), identities: await identitiesFor(fresh.id) })
})

routes.post('/logout', async (req, res) => {
  const token = bearer(req)
  if (token) await revokeSession(token)
  // Keluar selalu berhasil dari sudut pandang pemanggil.
  res.json({ ok: true })
})
