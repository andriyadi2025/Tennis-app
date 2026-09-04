import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'
import { config } from './config.ts'

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

/* ── Sandi ────────────────────────────────────────────────────────────────
 * scrypt dari pustaka standar Node. Sengaja tidak memakai dependensi:
 * scrypt sudah memory-hard dan cukup untuk kata sandi, dan satu dependensi
 * lebih sedikit berarti satu permukaan serangan lebih sedikit.
 * ─────────────────────────────────────────────────────────────────────── */

const SCRYPT_KEYLEN = 64

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN)
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false

  const expected = Buffer.from(hashHex, 'hex')
  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length)
  // Panjang harus sama sebelum timingSafeEqual, kalau tidak ia melempar.
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}

/* ── Token ────────────────────────────────────────────────────────────────
 * Token sesi dan token email dikirim ke pengguna dalam bentuk mentah, tapi
 * yang disimpan hanya HMAC-nya. Database yang bocor karena itu tidak
 * langsung memberi penyerang sesi yang bisa dipakai.
 * ─────────────────────────────────────────────────────────────────────── */

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function hashToken(token: string): string {
  return createHmac('sha256', config.tokenPepper).update(token).digest('hex')
}

/* ── OTP ──────────────────────────────────────────────────────────────────
 * Enam digit dari sumber acak kriptografis, bukan Math.random(). Kodenya
 * pun di-hash sebelum disimpan: petugas yang bisa membaca database tetap
 * tidak bisa membaca kode yang sedang berlaku milik orang lain.
 * ─────────────────────────────────────────────────────────────────────── */

export function newOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashOtp(phone: string, code: string): string {
  // Nomor ikut di-hash supaya kode yang sama untuk nomor berbeda tidak
  // menghasilkan hash yang sama.
  return createHmac('sha256', config.tokenPepper).update(`${phone}:${code}`).digest('hex')
}

/** Perbandingan tahan-waktu untuk dua string hex sepanjang apa pun. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/* ── PKCE ─────────────────────────────────────────────────────────────── */

export function newCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * PKCE S256 menurut RFC 7636: BASE64URL(SHA256(verifier)) — hash biasa,
 * bukan HMAC. Kalau ini salah, penyedia menolak penukaran kode dengan pesan
 * yang tidak menjelaskan apa-apa.
 */
export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}
