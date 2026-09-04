import { STORAGE_KEYS, readJson } from './storage'

/**
 * Pembungkus fetch tipis. Error HTTP dilempar sebagai `ApiError` supaya
 * TanStack Query bisa membedakan "gagal jaringan" dari "slot keburu diambil",
 * dan UI bisa menampilkan pesan yang tepat alih-alih "Something went wrong".
 *
 * Tiap permintaan membawa token sesi. Dulu tidak perlu — domainnya dilayani
 * MSW di dalam browser, jadi tidak ada yang perlu dibuktikan. Sekarang server
 * yang menentukan booking dan poin siapa yang dikembalikan, dan itu ditentukan
 * token, bukan badan permintaan yang bisa ditulis siapa saja.
 */

function sessionToken(): string | null {
  // Dibaca dari penyimpanan, bukan dari store Zustand: `api.ts` dipakai juga
  // di luar pohon React, dan mengimpor store dari sini membuat lingkaran
  // ketergantungan antara lapisan jaringan dan lapisan state.
  return readJson<{ token: string | null }>(STORAGE_KEYS.auth, { token: null }).token
}

function authHeaders(extra: HeadersInit = {}): HeadersInit {
  const token = sessionToken()
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra
}
export class ApiError extends Error {
  readonly status: number
  readonly code: string | null
  readonly details: unknown

  constructor(status: number, message: string, code: string | null, details: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

interface ErrorBody {
  message?: string
  code?: string
  [key: string]: unknown
}

async function parseError(response: Response): Promise<ApiError> {
  let body: ErrorBody = {}
  try {
    body = (await response.json()) as ErrorBody
  } catch {
    // Respons tanpa JSON — pakai statusText.
  }
  return new ApiError(
    response.status,
    body.message ?? response.statusText ?? 'Terjadi kesalahan.',
    body.code ?? null,
    body,
  )
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal, headers: authHeaders() })
  if (!response.ok) throw await parseError(response)
  return (await response.json()) as T
}

async function send<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: authHeaders(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!response.ok) throw await parseError(response)
  return (await response.json()) as T
}

export function apiPatch<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return send<T>('PATCH', path, body, signal)
}

export function apiDelete<T>(path: string, signal?: AbortSignal): Promise<T> {
  return send<T>('DELETE', path, undefined, signal)
}

export async function apiPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) throw await parseError(response)
  return (await response.json()) as T
}

/** Query string dari objek, melewatkan nilai kosong. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v === null || v === undefined || v === '') return
    search.set(k, String(v))
  })
  const text = search.toString()
  return text ? `?${text}` : ''
}
