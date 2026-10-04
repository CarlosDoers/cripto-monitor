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

/**
 * Where storage is blocked the token lives in memory for the visit: every
 * request reads it, so an unguarded `localStorage` threw on each one and the
 * app never loaded.
 */
let memoryToken = ''

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? memoryToken
  } catch {
    return memoryToken
  }
}

export function setToken(token: string): void {
  memoryToken = token
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Kept in memory above.
  }
}

async function request(search: string, endpoint = '/api/okx', method = 'GET'): Promise<unknown> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers['x-app-token'] = token

  const response = await fetch(`${endpoint}${search ? `?${search}` : ''}`, { headers, method })
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

/** One day of the net-worth history the app keeps (see `api/_history.ts`). */
export interface HistoryPoint {
  date: string
  at: number
  netWorth: number
  tradingEq: number
  openPnl: number
}

export interface NetWorthHistory {
  /** False until a Blob store is linked to the Vercel project. */
  enabled: boolean
  points: HistoryPoint[]
}

export async function netWorthHistory(): Promise<NetWorthHistory> {
  return (await request('', '/api/history')) as NetWorthHistory
}

/** Records today's point; the server measures it from OKX. */
export async function recordNetWorth(): Promise<NetWorthHistory> {
  return (await request('', '/api/history', 'POST')) as NetWorthHistory
}
