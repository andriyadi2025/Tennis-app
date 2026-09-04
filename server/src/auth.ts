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
export function syncRole(user: UserRow): UserRow {
  const should = roleFor(user.phone, user.email)
  if (should === user.role) return user
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(should, user.id)
  return { ...user, role: should }
}

/* ── User ────────────────────────────────────────────────────────────────── */

function now(): string {
  return new Date().toISOString()
}

export function findUserById(id: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
}

export function findUserByPhone(phone: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE phone = ?').get(phone) as UserRow | undefined
}

export function findUserByEmail(email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined
}

interface CreateUser {
  name: string
  phone?: string | null
  phoneVerified?: boolean
  email?: string | null
  emailVerified?: boolean
  passwordHash?: string | null
}

export function createUser(input: CreateUser): UserRow {
  const id = `u-${randomUUID()}`
  db.prepare(
    `INSERT INTO users (id, name, phone, phone_verified, email, email_verified, password_hash, role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.phone ?? null,
    input.phoneVerified ? 1 : 0,
    input.email ?? null,
    input.emailVerified ? 1 : 0,
    input.passwordHash ?? null,
    roleFor(input.phone ?? null, input.email ?? null),
    now(),
  )
  return findUserById(id)!
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

export function createSession(userId: string): { token: string; expiresAt: string } {
  const token = newToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000).toISOString()
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(hashToken(token), userId, now(), expiresAt)
  return { token, expiresAt }
}

export function userForSession(token: string): UserRow | undefined {
  const row = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .get(hashToken(token)) as { user_id: string; expires_at: string } | undefined
  if (!row) return undefined
  if (new Date(row.expires_at).getTime() <= Date.now()) return undefined
  return findUserById(row.user_id)
}

export function revokeSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
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
export function issueOtp(phone: string, at: Date = new Date()): OtpIssue {
  const latest = db
    .prepare('SELECT * FROM otp_codes WHERE phone = ? ORDER BY created_at DESC LIMIT 1')
    .get(phone) as OtpRow | undefined

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
  const { count } = db
    .prepare('SELECT COUNT(*) AS count FROM otp_codes WHERE phone = ? AND created_at > ?')
    .get(phone, hourAgo) as { count: number }
  if (count >= OTP_MAX_PER_HOUR) {
    return { ok: false, reason: 'rateLimit', retryAfterSeconds: 3_600 }
  }

  // Kode lama dianggap hangus begitu ada yang baru — hanya satu yang berlaku.
  db.prepare('UPDATE otp_codes SET consumed = 1 WHERE phone = ? AND consumed = 0').run(phone)

  const code = newOtpCode()
  const expiresAt = new Date(at.getTime() + OTP_TTL_MINUTES * 60_000).toISOString()
  db.prepare(
    `INSERT INTO otp_codes (id, phone, code_hash, attempts, consumed, created_at, expires_at)
     VALUES (?, ?, ?, 0, 0, ?, ?)`,
  ).run(`otp-${randomUUID()}`, phone, hashOtp(phone, code), at.toISOString(), expiresAt)

  return { ok: true, code, expiresAt }
}

export type OtpCheck =
  | { ok: true }
  | {
      ok: false
      reason: 'notFound' | 'expired' | 'tooManyAttempts' | 'wrong'
      attemptsLeft: number
    }

export function verifyOtp(phone: string, code: string, at: Date = new Date()): OtpCheck {
  const row = db
    .prepare(
      'SELECT * FROM otp_codes WHERE phone = ? AND consumed = 0 ORDER BY created_at DESC LIMIT 1',
    )
    .get(phone) as OtpRow | undefined

  if (!row) return { ok: false, reason: 'notFound', attemptsLeft: 0 }
  if (new Date(row.expires_at).getTime() <= at.getTime()) {
    return { ok: false, reason: 'expired', attemptsLeft: 0 }
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: 'tooManyAttempts', attemptsLeft: 0 }
  }

  if (!safeEqual(row.code_hash, hashOtp(phone, code))) {
    const attempts = row.attempts + 1
    db.prepare('UPDATE otp_codes SET attempts = ? WHERE id = ?').run(attempts, row.id)
    const left = Math.max(0, OTP_MAX_ATTEMPTS - attempts)
    // Kode dihanguskan begitu jatah tebakan habis, bukan dibiarkan hidup.
    if (left === 0) db.prepare('UPDATE otp_codes SET consumed = 1 WHERE id = ?').run(row.id)
    return { ok: false, reason: left === 0 ? 'tooManyAttempts' : 'wrong', attemptsLeft: left }
  }

  db.prepare('UPDATE otp_codes SET consumed = 1 WHERE id = ?').run(row.id)
  return { ok: true }
}

/* ── Token email ─────────────────────────────────────────────────────────── */

export function issueEmailToken(userId: string, purpose: 'verify' | 'reset'): string {
  const token = newToken()
  const expiresAt = new Date(Date.now() + EMAIL_TOKEN_TTL_HOURS * 3_600_000).toISOString()
  db.prepare(
    'INSERT INTO email_tokens (token_hash, user_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(hashToken(token), userId, purpose, now(), expiresAt)
  return token
}

export function consumeEmailToken(token: string, purpose: 'verify' | 'reset'): UserRow | undefined {
  const hash = hashToken(token)
  const row = db
    .prepare('SELECT user_id, purpose, expires_at FROM email_tokens WHERE token_hash = ?')
    .get(hash) as { user_id: string; purpose: string; expires_at: string } | undefined

  if (!row || row.purpose !== purpose) return undefined
  if (new Date(row.expires_at).getTime() <= Date.now()) return undefined

  // Sekali pakai: dihapus sebelum dipakai, bukan sesudah.
  db.prepare('DELETE FROM email_tokens WHERE token_hash = ?').run(hash)
  return findUserById(row.user_id)
}

export function markEmailVerified(userId: string): void {
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId)
}

/* ── Identitas OAuth ─────────────────────────────────────────────────────── */

export function findUserByIdentity(provider: string, subject: string): UserRow | undefined {
  const row = db
    .prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?')
    .get(provider, subject) as { user_id: string } | undefined
  return row ? findUserById(row.user_id) : undefined
}

export function linkIdentity(
  userId: string,
  provider: string,
  subject: string,
  email: string | null,
): void {
  db.prepare(
    'INSERT OR IGNORE INTO identities (id, user_id, provider, subject, email, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(`id-${randomUUID()}`, userId, provider, subject, email, now())
}

export function identitiesFor(userId: string): { provider: string; email: string | null }[] {
  return db.prepare('SELECT provider, email FROM identities WHERE user_id = ?').all(userId) as {
    provider: string
    email: string | null
  }[]
}

/* ── Ganti sandi & cabut sesi ────────────────────────────────────────────── */

export function setPassword(userId: string, passwordHash: string): void {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId)
}

/**
 * Semua sesi dicabut setelah sandi diganti.
 *
 * Kalau tidak, orang yang memakai sandi lama — termasuk yang membuat
 * pemiliknya perlu me-reset — tetap masuk di perangkatnya sendiri, dan
 * reset itu tidak menyelesaikan apa pun.
 */
export function revokeAllSessions(userId: string): number {
  const { changes } = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  return Number(changes)
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
export function signInMethods(user: UserRow): SignInMethod[] {
  const methods: SignInMethod[] = []
  if (user.phone && user.phone_verified === 1) methods.push('phone')
  if (user.email && user.password_hash) methods.push('email')
  for (const { provider } of identitiesFor(user.id)) {
    if (provider === 'google' || provider === 'facebook') methods.push(provider)
  }
  return methods
}

export function attachPhone(userId: string, phone: string): void {
  db.prepare('UPDATE users SET phone = ?, phone_verified = 1 WHERE id = ?').run(phone, userId)
}

export function attachEmail(userId: string, email: string, passwordHash: string | null): void {
  db.prepare(
    'UPDATE users SET email = ?, email_verified = 0, password_hash = COALESCE(?, password_hash) WHERE id = ?',
  ).run(email, passwordHash, userId)
}

export function detachPhone(userId: string): void {
  db.prepare('UPDATE users SET phone = NULL, phone_verified = 0 WHERE id = ?').run(userId)
}

/**
 * Melepas email ikut membuang sandinya. Sandi tanpa email tidak bisa dipakai
 * masuk lewat layar mana pun, jadi meninggalkannya cuma menyisakan kredensial
 * menganggur di basis data.
 */
export function detachEmail(userId: string): void {
  db.prepare(
    'UPDATE users SET email = NULL, email_verified = 0, password_hash = NULL WHERE id = ?',
  ).run(userId)
}

export function unlinkIdentity(userId: string, provider: string): boolean {
  const { changes } = db
    .prepare('DELETE FROM identities WHERE user_id = ? AND provider = ?')
    .run(userId, provider)
  return Number(changes) > 0
}

/** Pemilik sebuah identitas penyedia, kalau ada — dipakai menolak rebutan. */
export function ownerOfIdentity(provider: string, subject: string): string | null {
  const row = db
    .prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?')
    .get(provider, subject) as { user_id: string } | undefined
  return row?.user_id ?? null
}
