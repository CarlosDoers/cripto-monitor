import type { OkxEnvelope } from './types'

const TOKEN_KEY = 'cripto-monitor:token'

export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }

  get isUnauthorized() {
    return this.status === 401
  }

  /** The server has no OKX credentials configured yet. */
  get isNotConfigured() {
    return this.status === 503
  }
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

export function setToken(token: string): void {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

async function request(search: string): Promise<unknown> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers['x-app-token'] = token

  const response = await fetch(`/api/okx?${search}`, { headers })
  const text = await response.text()

  let payload: unknown
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    throw new ApiError('Respuesta no válida del servidor.', response.status)
  }

  if (!response.ok) {
    const err = payload as { message?: string; error?: string; code?: string }
    throw new ApiError(
      err.message || err.error || `Error ${response.status}`,
      response.status,
      err.code,
    )
  }

  return payload
}

/**
 * Calls one OKX endpoint through the signing proxy and returns its `data` array.
 * `path` is the raw OKX path — the proxy validates it against its allowlist.
 */
export async function okx<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T[]> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') query.set(key, String(value))
  }
  const full = query.size ? `${path}?${query}` : path

  const payload = (await request(
    new URLSearchParams({ path: full }).toString(),
  )) as OkxEnvelope<T>

  return payload.data ?? []
}

export interface ProbeResult {
  configured: boolean
  simulated: boolean
}

/**
 * Checks whether the stored token (if any) is accepted and whether the server
 * has OKX credentials. Throws ApiError(401) when a token is required.
 */
export async function probe(): Promise<ProbeResult> {
  return (await request('probe=1')) as ProbeResult
}
