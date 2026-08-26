/**
 * Pembungkus fetch tipis. Error HTTP dilempar sebagai `ApiError` supaya
 * TanStack Query bisa membedakan "gagal jaringan" dari "slot keburu diambil",
 * dan UI bisa menampilkan pesan yang tepat alih-alih "Something went wrong".
 */
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
  const response = await fetch(path, { signal })
  if (!response.ok) throw await parseError(response)
  return (await response.json()) as T
}

export async function apiPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
