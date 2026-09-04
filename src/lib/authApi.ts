import { ApiError } from './api'

/**
 * Klien untuk server autentikasi sungguhan. Dipisah dari `api.ts` karena
 * beda sifatnya: yang ini berbicara ke server nyata dan membawa token sesi,
 * sedangkan sisanya masih dilayani MSW di dalam browser.
 */

export interface AuthUser {
  id: string
  name: string
  phone: string | null
  phoneVerified: boolean
  email: string | null
  emailVerified: boolean
  role: 'member' | 'admin'
  createdAt: string
}

export interface Identity {
  provider: string
  email: string | null
}

export interface SignInResult {
  token: string
  expiresAt: string
  user: AuthUser
  identities: Identity[]
  /** Hanya ada di luar produksi, saat email belum benar-benar dikirim. */
  devToken?: string
  delivery?: 'twilio' | 'smtp' | 'log'
}

export interface ProviderStatus {
  phone: boolean
  email: boolean
  google: boolean
  facebook: boolean
  smsDelivery: 'twilio' | 'log'
  emailDelivery: 'smtp' | 'log'
}

export interface OtpRequested {
  phone: string
  expiresAt: string
  resendAfterSeconds: number
  delivery: 'twilio' | 'log'
  /** Hanya di luar produksi — supaya alurnya bisa diselesaikan tanpa SMS. */
  devCode?: string
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/auth${path}`, init)
  if (!response.ok) {
    let body: { message?: string; code?: string } = {}
    try {
      body = (await response.json()) as typeof body
    } catch {
      // Balasan tanpa JSON — pakai statusText.
    }
    throw new ApiError(
      response.status,
      body.message ?? response.statusText ?? 'Terjadi kesalahan.',
      body.code ?? null,
      body,
    )
  }
  return (await response.json()) as T
}

function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  return call<T>(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

export function fetchProviders(): Promise<ProviderStatus> {
  return call<ProviderStatus>('/providers')
}

export function requestOtp(phone: string): Promise<OtpRequested> {
  return post<OtpRequested>('/phone/request-otp', { phone })
}

export function verifyOtp(phone: string, code: string, name?: string): Promise<SignInResult> {
  return post<SignInResult>('/phone/verify-otp', { phone, code, name })
}

export function registerWithEmail(
  name: string,
  email: string,
  password: string,
): Promise<SignInResult> {
  return post<SignInResult>('/email/register', { name, email, password })
}

export function loginWithEmail(email: string, password: string): Promise<SignInResult> {
  return post<SignInResult>('/email/login', { email, password })
}

export function verifyEmailToken(token: string): Promise<{ ok: true; user: AuthUser }> {
  return post('/email/verify', { token })
}

export function resendVerification(
  sessionToken: string,
): Promise<{ ok: true; delivery: string; devToken?: string }> {
  return post('/email/resend-verification', {}, sessionToken)
}

export function fetchMe(token: string): Promise<{ user: AuthUser; identities: Identity[] }> {
  return call('/me', { headers: { Authorization: `Bearer ${token}` } })
}

export function logout(token: string): Promise<{ ok: true }> {
  return post('/logout', {}, token)
}

/** Alur OAuth meninggalkan halaman — server yang mengarahkan ke penyedia. */
export function oauthUrl(provider: 'google' | 'facebook'): string {
  return `/api/auth/oauth/${provider}/start`
}

/* ── Lupa kata sandi ─────────────────────────────────────────────────────── */

export interface ForgotResult {
  ok: true
  message: string
  delivery?: 'smtp' | 'log'
  /** Hanya di luar produksi — supaya alurnya bisa diselesaikan tanpa SMTP. */
  devToken?: string
}

export function forgotPassword(email: string): Promise<ForgotResult> {
  return post<ForgotResult>('/password/forgot', { email })
}

export function resetPassword(token: string, password: string): Promise<SignInResult> {
  return post<SignInResult>('/password/reset', { token, password })
}

/* ── Menyambungkan cara masuk ────────────────────────────────────────────── */

export type SignInMethod = 'phone' | 'email' | 'google' | 'facebook'

export interface LinkState {
  /** Cara masuk yang benar-benar bisa dipakai akun ini. */
  methods: SignInMethod[]
  user: AuthUser
  identities: Identity[]
  delivery?: 'smtp' | 'log'
  devToken?: string
}

function del<T>(path: string, token: string): Promise<T> {
  return call<T>(path, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
}

export function fetchLinkState(token: string): Promise<LinkState> {
  return call<LinkState>('/link', { headers: { Authorization: `Bearer ${token}` } })
}

export function requestLinkOtp(token: string, phone: string): Promise<OtpRequested> {
  return post<OtpRequested>('/link/phone/request-otp', { phone }, token)
}

export function verifyLinkOtp(token: string, phone: string, code: string): Promise<LinkState> {
  return post<LinkState>('/link/phone/verify', { phone, code }, token)
}

export function linkEmail(token: string, email: string, password?: string): Promise<LinkState> {
  return post<LinkState>('/link/email', { email, password }, token)
}

/**
 * Memulai OAuth untuk menyambung. Server mengembalikan URL alih-alih
 * mengarahkan langsung: permintaan ini membawa header Authorization, dan
 * redirect akan kehilangan header itu di perjalanan.
 */
export function startLinkOAuth(
  token: string,
  provider: 'google' | 'facebook',
): Promise<{ url: string }> {
  return call<{ url: string }>(`/link/${provider}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function unlinkMethod(token: string, method: SignInMethod): Promise<LinkState> {
  return del<LinkState>(`/link/${method}`, token)
}

/* ── Menggabungkan dua akun ──────────────────────────────────────────────── */

export interface MergePreview {
  bookings: number
  merchOrders: number
  complaints: number
  registrations: number
  teams: number
  points: number
}

export interface MergeRequested {
  phone: string
  expiresAt: string
  delivery: 'twilio' | 'log'
  /** Isi akun yang akan diserap — ditunjukkan sebelum diputuskan. */
  preview: MergePreview
  devCode?: string
}

export interface MergeResult {
  ok: true
  user: AuthUser
  identities: Identity[]
  methods: SignInMethod[]
  merged: {
    moved: Record<string, number>
    skipped: Record<string, number>
    pointsAdded: number
    contacts: { moved: string[]; released: string[] }
  }
}

export function requestMergeOtp(token: string, phone: string): Promise<MergeRequested> {
  return post<MergeRequested>('/merge/request-otp', { phone }, token)
}

export function confirmMerge(token: string, phone: string, code: string): Promise<MergeResult> {
  return post<MergeResult>('/merge/confirm', { phone, code }, token)
}
