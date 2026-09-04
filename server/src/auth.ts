import { randomUUID } from 'node:crypto'
import { db, type UserRow } from './db.ts'
import { hashOtp, hashToken, newOtpCode, newToken, safeEqual } from './crypto.ts'
import { config } from './config.ts'

/* ── Aturan yang bisa diuji, terpisah dari HTTP ──────────────────────────── */

export const SESSION_TTL_DAYS = 30
export const OTP_TTL_MINUTES = 5
export const OTP_MAX_ATTEMPTS = 5
export const OTP_RESEND_COOLDOWN_SECONDS = 60
/** Batas jumlah OTP per nomor dalam satu jam. */
export const OTP_MAX_PER_HOUR = 5
export const EMAIL_TOKEN_TTL_HOURS = 24

/**
 * Nomor Indonesia dinormalkan ke bentuk E.164 (+62…) supaya "08123",
 * "8123", dan "+628123" tidak jadi tiga akun berbeda.
 */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '').replace(/^\+/, '')
  if (!/^\d+$/.test(digits)) return null

  let national = digits
  if (national.startsWith('62')) national = national.slice(2)
  else if (national.startsWith('0')) national = national.slice(1)

  // Nomor seluler Indonesia: 9–13 digit setelah kode negara.
  if (national.length < 9 || national.length > 13) return null
  if (!national.startsWith('8')) return null
  return `+62${national}`
}

export function normaliseEmail(input: string): string | null {
  const email = input.trim().toLowerCase()
  // Sengaja longgar: validasi email yang ketat menolak alamat yang sah.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null
  return email
}

export interface PasswordProblem {
  message: string
}

/** Panjang mengalahkan kerumitan; aturannya sedikit tapi ditegakkan. */
export function checkPassword(password: string): PasswordProblem | null {
  if (password.length < 8) return { message: 'Kata sandi minimal 8 karakter.' }
  if (password.length > 200) return { message: 'Kata sandi terlalu panjang.' }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return { message: 'Kata sandi harus memuat huruf dan angka.' }
  }
  return null
}

/**
 * Peran diturunkan dari daftar kontak admin, bukan disimpan sekali lalu
 * dilupakan. Menambah pengurus baru cukup mengubah ADMIN_CONTACTS dan
 * memintanya masuk lagi.
 */
export function roleFor(phone: string | null, email: string | null): 'member' | 'admin' {
  const contacts = config.adminContacts
  if (contacts.length === 0) return 'member'
  const mine = [phone, email].filter(Boolean).map((v) => v!.toLowerCase())
  return mine.some((value) => contacts.includes(value)) ? 'admin' : 'member'
}

/** Menyelaraskan peran tersimpan dengan daftar terkini. */
export async function syncRole(user: UserRow): Promise<UserRow> {
  const should = roleFor(user.phone, user.email)
  if (should === user.role) return user
  await db.run('UPDATE users SET role = ? WHERE id = ?', [should, user.id])
  return { ...user, role: should }
}

/* ── User ────────────────────────────────────────────────────────────────── */

function now(): string {
  return new Date().toISOString()
}

export function findUserById(id: string): Promise<UserRow | undefined> {
  return db.get<UserRow>('SELECT * FROM users WHERE id = ?', [id])
}

export function findUserByPhone(phone: string): Promise<UserRow | undefined> {
  return db.get<UserRow>('SELECT * FROM users WHERE phone = ?', [phone])
}

export function findUserByEmail(email: string): Promise<UserRow | undefined> {
  return db.get<UserRow>('SELECT * FROM users WHERE email = ?', [email])
}

interface CreateUser {
  name: string
  phone?: string | null
  phoneVerified?: boolean
  email?: string | null
  emailVerified?: boolean
  passwordHash?: string | null
}

export async function createUser(input: CreateUser): Promise<UserRow> {
  const id = `u-${randomUUID()}`
  await db.run(
    `INSERT INTO users (id, name, phone, phone_verified, email, email_verified, password_hash, role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.phone ?? null,
      input.phoneVerified ? 1 : 0,
      input.email ?? null,
      input.emailVerified ? 1 : 0,
      input.passwordHash ?? null,
      roleFor(input.phone ?? null, input.email ?? null),
      now(),
    ],
  )
  return (await findUserById(id))!
}

/** Bentuk user yang aman dikirim ke klien — tanpa hash sandi. */
export function publicUser(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    phoneVerified: row.phone_verified === 1,
    email: row.email,
    emailVerified: row.email_verified === 1,
    role: row.role,
    createdAt: row.created_at,
  }
}

/* ── Sesi ────────────────────────────────────────────────────────────────── */

export async function createSession(userId: string): Promise<{ token: string; expiresAt: string }> {
  const token = newToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000).toISOString()
  await db.run(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    [hashToken(token), userId, now(), expiresAt],
  )
  return { token, expiresAt }
}

export async function userForSession(token: string): Promise<UserRow | undefined> {
  const row = await db.get<{ user_id: string; expires_at: string }>(
    'SELECT user_id, expires_at FROM sessions WHERE token_hash = ?',
    [hashToken(token)],
  )
  if (!row) return undefined
  if (new Date(row.expires_at).getTime() <= Date.now()) return undefined
  return findUserById(row.user_id)
}

export async function revokeSession(token: string): Promise<void> {
  await db.run('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)])
}

/* ── OTP ─────────────────────────────────────────────────────────────────── */

export type OtpIssue =
  | { ok: true; code: string; expiresAt: string }
  | { ok: false; reason: 'cooldown' | 'rateLimit'; retryAfterSeconds: number }

interface OtpRow {
  id: string
  phone: string
  code_hash: string
  attempts: number
  consumed: number
  created_at: string
  expires_at: string
}

/**
 * Menerbitkan OTP dengan dua rem: jeda kirim ulang, dan batas per jam.
 * Keduanya diperiksa di server — tombol yang di-disable di UI bukan
 * pengaman, hanya kesopanan.
 */
export async function issueOtp(phone: string, at: Date = new Date()): Promise<OtpIssue> {
  const latest = await db.get<OtpRow>(
    'SELECT * FROM otp_codes WHERE phone = ? ORDER BY created_at DESC LIMIT 1',
    [phone],
  )

  if (latest) {
    const since = (at.getTime() - new Date(latest.created_at).getTime()) / 1000
    if (since < OTP_RESEND_COOLDOWN_SECONDS) {
      return {
        ok: false,
        reason: 'cooldown',
        retryAfterSeconds: Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - since),
      }
    }
  }

  const hourAgo = new Date(at.getTime() - 3_600_000).toISOString()
  const counted = await db.get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM otp_codes WHERE phone = ? AND created_at > ?',
    [phone, hourAgo],
  )
  // Postgres mengembalikan COUNT sebagai string; Number() menyamakan keduanya.
  const count = Number(counted?.count ?? 0)
  if (count >= OTP_MAX_PER_HOUR) {
    return { ok: false, reason: 'rateLimit', retryAfterSeconds: 3_600 }
  }

  // Kode lama dianggap hangus begitu ada yang baru — hanya satu yang berlaku.
  await db.run('UPDATE otp_codes SET consumed = 1 WHERE phone = ? AND consumed = 0', [phone])

  const code = newOtpCode()
  const expiresAt = new Date(at.getTime() + OTP_TTL_MINUTES * 60_000).toISOString()
  await db.run(
    `INSERT INTO otp_codes (id, phone, code_hash, attempts, consumed, created_at, expires_at)
     VALUES (?, ?, ?, 0, 0, ?, ?)`,
    [`otp-${randomUUID()}`, phone, hashOtp(phone, code), at.toISOString(), expiresAt],
  )

  return { ok: true, code, expiresAt }
}

export type OtpCheck =
  | { ok: true }
  | {
      ok: false
      reason: 'notFound' | 'expired' | 'tooManyAttempts' | 'wrong'
      attemptsLeft: number
    }

export async function verifyOtp(
  phone: string,
  code: string,
  at: Date = new Date(),
): Promise<OtpCheck> {
  const row = await db.get<OtpRow>(
    'SELECT * FROM otp_codes WHERE phone = ? AND consumed = 0 ORDER BY created_at DESC LIMIT 1',
    [phone],
  )

  if (!row) return { ok: false, reason: 'notFound', attemptsLeft: 0 }
  if (new Date(row.expires_at).getTime() <= at.getTime()) {
    return { ok: false, reason: 'expired', attemptsLeft: 0 }
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: 'tooManyAttempts', attemptsLeft: 0 }
  }

  if (!safeEqual(row.code_hash, hashOtp(phone, code))) {
    const attempts = row.attempts + 1
    await db.run('UPDATE otp_codes SET attempts = ? WHERE id = ?', [attempts, row.id])
    const left = Math.max(0, OTP_MAX_ATTEMPTS - attempts)
    // Kode dihanguskan begitu jatah tebakan habis, bukan dibiarkan hidup.
    if (left === 0) await db.run('UPDATE otp_codes SET consumed = 1 WHERE id = ?', [row.id])
    return { ok: false, reason: left === 0 ? 'tooManyAttempts' : 'wrong', attemptsLeft: left }
  }

  await db.run('UPDATE otp_codes SET consumed = 1 WHERE id = ?', [row.id])
  return { ok: true }
}

/* ── Token email ─────────────────────────────────────────────────────────── */

export async function issueEmailToken(
  userId: string,
  purpose: 'verify' | 'reset',
): Promise<string> {
  const token = newToken()
  const expiresAt = new Date(Date.now() + EMAIL_TOKEN_TTL_HOURS * 3_600_000).toISOString()
  await db.run(
    'INSERT INTO email_tokens (token_hash, user_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    [hashToken(token), userId, purpose, now(), expiresAt],
  )
  return token
}

export async function consumeEmailToken(
  token: string,
  purpose: 'verify' | 'reset',
): Promise<UserRow | undefined> {
  const hash = hashToken(token)
  const row = await db.get<{ user_id: string; purpose: string; expires_at: string }>(
    'SELECT user_id, purpose, expires_at FROM email_tokens WHERE token_hash = ?',
    [hash],
  )

  if (!row || row.purpose !== purpose) return undefined
  if (new Date(row.expires_at).getTime() <= Date.now()) return undefined

  // Sekali pakai: dihapus sebelum dipakai, bukan sesudah.
  await db.run('DELETE FROM email_tokens WHERE token_hash = ?', [hash])
  return findUserById(row.user_id)
}

export async function markEmailVerified(userId: string): Promise<void> {
  await db.run('UPDATE users SET email_verified = 1 WHERE id = ?', [userId])
}

/* ── Identitas OAuth ─────────────────────────────────────────────────────── */

export async function findUserByIdentity(
  provider: string,
  subject: string,
): Promise<UserRow | undefined> {
  const row = await db.get<{ user_id: string }>(
    'SELECT user_id FROM identities WHERE provider = ? AND subject = ?',
    [provider, subject],
  )
  return row ? findUserById(row.user_id) : undefined
}

export async function linkIdentity(
  userId: string,
  provider: string,
  subject: string,
  email: string | null,
): Promise<void> {
  /*
   * ON CONFLICT, bukan INSERT OR IGNORE: yang kedua hanya dikenal SQLite dan
   * akan meledak di Postgres. Menyebut kolomnya juga membatasi konflik yang
   * dimaafkan pada yang memang diharapkan — identitas yang sudah tertaut —
   * bukan setiap pelanggaran batasan apa pun.
   */
  await db.run(
    `INSERT INTO identities (id, user_id, provider, subject, email, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (provider, subject) DO NOTHING`,
    [`id-${randomUUID()}`, userId, provider, subject, email, now()],
  )
}

export function identitiesFor(
  userId: string,
): Promise<{ provider: string; email: string | null }[]> {
  return db.all<{ provider: string; email: string | null }>(
    'SELECT provider, email FROM identities WHERE user_id = ?',
    [userId],
  )
}

/* ── Ganti sandi & cabut sesi ────────────────────────────────────────────── */

export async function setPassword(userId: string, passwordHash: string): Promise<void> {
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId])
}

/**
 * Semua sesi dicabut setelah sandi diganti.
 *
 * Kalau tidak, orang yang memakai sandi lama — termasuk yang membuat
 * pemiliknya perlu me-reset — tetap masuk di perangkatnya sendiri, dan
 * reset itu tidak menyelesaikan apa pun.
 */
export async function revokeAllSessions(userId: string): Promise<number> {
  const { changes } = await db.run('DELETE FROM sessions WHERE user_id = ?', [userId])
  return changes
}

/* ── Menyambung & melepas cara masuk ─────────────────────────────────────── */

export type SignInMethod = 'phone' | 'email' | 'google' | 'facebook'

/**
 * Cara masuk yang benar-benar bisa dipakai akun ini.
 *
 * Email tanpa sandi **tidak** dihitung: tidak ada layar yang menerima email
 * saja. Menghitungnya akan membuat aturan "sisakan minimal satu" meloloskan
 * akun yang sebenarnya sudah terkunci.
 */
export async function signInMethods(user: UserRow): Promise<SignInMethod[]> {
  const methods: SignInMethod[] = []
  if (user.phone && user.phone_verified === 1) methods.push('phone')
  if (user.email && user.password_hash) methods.push('email')
  for (const { provider } of await identitiesFor(user.id)) {
    if (provider === 'google' || provider === 'facebook') methods.push(provider)
  }
  return methods
}

export async function attachPhone(userId: string, phone: string): Promise<void> {
  await db.run('UPDATE users SET phone = ?, phone_verified = 1 WHERE id = ?', [phone, userId])
}

export async function attachEmail(
  userId: string,
  email: string,
  passwordHash: string | null,
): Promise<void> {
  await db.run(
    'UPDATE users SET email = ?, email_verified = 0, password_hash = COALESCE(?, password_hash) WHERE id = ?',
    [email, passwordHash, userId],
  )
}

export async function detachPhone(userId: string): Promise<void> {
  await db.run('UPDATE users SET phone = NULL, phone_verified = 0 WHERE id = ?', [userId])
}

/**
 * Melepas email ikut membuang sandinya. Sandi tanpa email tidak bisa dipakai
 * masuk lewat layar mana pun, jadi meninggalkannya cuma menyisakan kredensial
 * menganggur di basis data.
 */
export async function detachEmail(userId: string): Promise<void> {
  await db.run(
    'UPDATE users SET email = NULL, email_verified = 0, password_hash = NULL WHERE id = ?',
    [userId],
  )
}

export async function unlinkIdentity(userId: string, provider: string): Promise<boolean> {
  const { changes } = await db.run('DELETE FROM identities WHERE user_id = ? AND provider = ?', [
    userId,
    provider,
  ])
  return changes > 0
}

/** Pemilik sebuah identitas penyedia, kalau ada — dipakai menolak rebutan. */
export async function ownerOfIdentity(provider: string, subject: string): Promise<string | null> {
  const row = await db.get<{ user_id: string }>(
    'SELECT user_id FROM identities WHERE provider = ? AND subject = ?',
    [provider, subject],
  )
  return row?.user_id ?? null
}

/* ── Penggabungan akun ───────────────────────────────────────────────────── */

export interface ContactMove {
  /** Kontak yang benar-benar pindah ke akun tujuan. */
  moved: ('phone' | 'email')[]
  /** Kontak akun sumber yang dilepas karena slotnya sudah terisi. */
  released: ('phone' | 'email')[]
}

/**
 * Memindahkan identitas OAuth dan kontak dari satu akun ke akun lain.
 *
 * Tabel `users` hanya memuat satu nomor dan satu email, jadi kontak yang
 * slotnya sudah terisi di akun tujuan **tidak bisa** ikut pindah. Yang
 * dilakukan bukan menimpanya diam-diam — kontak itu dilepas dan dilaporkan,
 * supaya orangnya tahu cara masuk mana yang hilang.
 */
export async function mergeAuthData(fromUserId: string, toUserId: string): Promise<ContactMove> {
  const from = await findUserById(fromUserId)
  const to = await findUserById(toUserId)
  if (!from || !to) throw new Error('Akun untuk digabungkan tidak ditemukan.')

  const move: ContactMove = { moved: [], released: [] }

  await db.transaction(async (tx) => {
    /*
     * Kontak dikosongkan dari akun sumber lebih dulu. Kolomnya UNIQUE, jadi
     * menulisnya ke akun tujuan sementara akun sumber masih memegangnya akan
     * ditolak basis data.
     */
    await tx.run('UPDATE users SET phone = NULL, email = NULL WHERE id = ?', [fromUserId])

    if (from.phone && !to.phone) {
      await tx.run('UPDATE users SET phone = ?, phone_verified = ? WHERE id = ?', [
        from.phone,
        from.phone_verified,
        toUserId,
      ])
      move.moved.push('phone')
    } else if (from.phone) {
      move.released.push('phone')
    }

    if (from.email && !to.email) {
      await tx.run(
        'UPDATE users SET email = ?, email_verified = ?, password_hash = COALESCE(password_hash, ?) WHERE id = ?',
        [from.email, from.email_verified, from.password_hash, toUserId],
      )
      move.moved.push('email')
    } else if (from.email) {
      move.released.push('email')
    }

    /*
     * Identitas penyedia pindah semuanya. Tidak ada bentrok yang mungkin:
     * kuncinya (provider, subject) dan akun sumber yang memegangnya.
     */
    await tx.run('UPDATE identities SET user_id = ? WHERE user_id = ?', [toUserId, fromUserId])

    // Sesi akun sumber dicabut sebelum akunnya hilang — perangkat yang masih
    // memegangnya harus masuk lagi, bukan menemui akun yang tidak ada.
    await tx.run('DELETE FROM sessions WHERE user_id = ?', [fromUserId])
    await tx.run('DELETE FROM email_tokens WHERE user_id = ?', [fromUserId])
    await tx.run('DELETE FROM users WHERE id = ?', [fromUserId])
  })

  return move
}
