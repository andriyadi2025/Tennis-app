import { randomUUID } from 'node:crypto'
import { config, type OAuthProvider } from './config.ts'
import { db } from './db.ts'
import { codeChallenge, newCodeVerifier, newToken } from './crypto.ts'

/**
 * OAuth 2.0 authorization-code, ditulis langsung tanpa pustaka. Alurnya
 * pendek dan tetap; yang penting justru bagian yang sering dilewatkan:
 * `state` disimpan di server (bukan cuma cookie), PKCE dipakai, dan client
 * secret tidak pernah meninggalkan proses ini.
 */

export type ProviderName = 'google' | 'facebook'

interface ProviderSpec {
  authorizeUrl: string
  tokenUrl: string
  profileUrl: string
  scope: string
  /** Facebook belum mendukung PKCE untuk semua tipe app. */
  usePkce: boolean
  parseProfile: (raw: unknown) => { subject: string; name: string; email: string | null } | null
}

const PROVIDERS: Record<ProviderName, ProviderSpec> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    profileUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
    usePkce: true,
    parseProfile: (raw) => {
      const p = raw as { sub?: string; name?: string; email?: string; email_verified?: boolean }
      if (!p.sub) return null
      return {
        subject: p.sub,
        name: p.name?.trim() || p.email?.split('@')[0] || 'Anggota',
        email: p.email ?? null,
      }
    },
  },
  facebook: {
    authorizeUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    profileUrl: 'https://graph.facebook.com/v21.0/me?fields=id,name,email',
    scope: 'email public_profile',
    usePkce: false,
    parseProfile: (raw) => {
      const p = raw as { id?: string; name?: string; email?: string }
      if (!p.id) return null
      // Facebook boleh tidak mengembalikan email sama sekali — pengguna bisa
      // menolaknya, atau akunnya terdaftar lewat nomor telepon.
      return { subject: p.id, name: p.name?.trim() || 'Anggota', email: p.email ?? null }
    },
  },
}

export function providerConfig(name: ProviderName): OAuthProvider | null {
  return name === 'google' ? config.google : config.facebook
}

export function redirectUri(name: ProviderName): string {
  return `${config.appOrigin.replace(/\/$/, '')}/api/auth/oauth/${name}/callback`
}

/**
 * Menyiapkan state + PKCE lalu mengembalikan URL untuk dikunjungi pengguna.
 *
 * `linkUserId` diisi kalau putaran ini untuk menyambungkan penyedia ke akun
 * yang sudah masuk. Ia dititipkan di baris state, bukan di URL: apa pun yang
 * ditaruh di URL bisa diubah pengguna, dan ini menentukan akun mana yang
 * mendapat identitas baru.
 */
export function beginOAuth(
  name: ProviderName,
  linkUserId: string | null = null,
): { url: string; state: string } | null {
  const credentials = providerConfig(name)
  if (!credentials) return null

  const spec = PROVIDERS[name]
  const state = newToken(24)
  const verifier = newCodeVerifier()

  db.prepare(
    'INSERT INTO oauth_states (state, provider, code_verifier, link_user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    state,
    name,
    verifier,
    linkUserId,
    new Date().toISOString(),
    new Date(Date.now() + 10 * 60_000).toISOString(),
  )

  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: redirectUri(name),
    response_type: 'code',
    scope: spec.scope,
    state,
  })
  if (spec.usePkce) {
    params.set('code_challenge', codeChallenge(verifier))
    params.set('code_challenge_method', 'S256')
  }

  return { url: `${spec.authorizeUrl}?${params.toString()}`, state }
}

interface StateRow {
  provider: string
  code_verifier: string
  /** Terisi kalau putaran ini menyambung, bukan masuk. */
  link_user_id: string | null
  expires_at: string
}

/** State sekali pakai: dihapus begitu diambil, sah atau tidak. */
export function takeOAuthState(state: string): StateRow | null {
  const row = db.prepare('SELECT * FROM oauth_states WHERE state = ?').get(state) as
    StateRow | undefined
  if (!row) return null
  db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state)
  if (new Date(row.expires_at).getTime() <= Date.now()) return null
  return row
}

export interface OAuthProfile {
  subject: string
  name: string
  email: string | null
}

/** Menukar kode dengan access token, lalu mengambil profilnya. */
export async function exchangeCode(
  name: ProviderName,
  code: string,
  verifier: string,
): Promise<OAuthProfile> {
  const credentials = providerConfig(name)
  if (!credentials) throw new Error(`Penyedia ${name} tidak dikonfigurasi.`)
  const spec = PROVIDERS[name]

  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(name),
  })
  if (spec.usePkce) body.set('code_verifier', verifier)

  const tokenResponse = await fetch(spec.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  })
  if (!tokenResponse.ok) {
    const detail = await tokenResponse.text().catch(() => '')
    throw new Error(`Penukaran kode gagal (${tokenResponse.status}): ${detail.slice(0, 200)}`)
  }

  const { access_token: accessToken } = (await tokenResponse.json()) as { access_token?: string }
  if (!accessToken) throw new Error('Penyedia tidak mengembalikan access token.')

  const profileResponse = await fetch(spec.profileUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })
  if (!profileResponse.ok) {
    throw new Error(`Gagal mengambil profil (${profileResponse.status}).`)
  }

  const profile = spec.parseProfile(await profileResponse.json())
  if (!profile) throw new Error('Profil dari penyedia tidak bisa dibaca.')
  return profile
}

export function newIdentityId(): string {
  return `id-${randomUUID()}`
}
