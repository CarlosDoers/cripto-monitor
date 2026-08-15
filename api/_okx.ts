import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signed read-only proxy to the OKX v5 REST API.
 *
 * The API secret never leaves this module: the browser asks for a path, we sign
 * it here with the server-side credentials and forward the response back.
 */

/**
 * Endpoints this proxy is willing to sign. Everything is GET and read-only, so
 * even a leaked deployment URL cannot place an order, transfer or withdraw —
 * regardless of what permissions the API key itself was granted.
 */
export const ALLOWED_PATHS = new Set([
  // Trading account
  '/api/v5/account/balance',
  '/api/v5/account/positions',
  '/api/v5/account/positions-history',
  '/api/v5/account/account-position-risk',
  '/api/v5/account/config',
  '/api/v5/account/account-info',
  '/api/v5/account/bills',
  '/api/v5/account/bills-archive',
  '/api/v5/account/max-withdrawal',
  '/api/v5/account/interest-accrued',
  '/api/v5/account/leverage-info',

  // Funding account
  '/api/v5/asset/balances',
  '/api/v5/asset/asset-valuation',
  '/api/v5/asset/bills',
  '/api/v5/asset/deposit-history',
  '/api/v5/asset/withdrawal-history',

  // Orders & fills
  '/api/v5/trade/orders-pending',
  '/api/v5/trade/orders-history',
  '/api/v5/trade/orders-history-archive',
  '/api/v5/trade/fills',
  '/api/v5/trade/fills-history',

  // Public market data
  '/api/v5/public/open-interest',
  '/api/v5/public/funding-rate',
  '/api/v5/public/price-limit',
  '/api/v5/market/ticker',
  '/api/v5/market/tickers',
  '/api/v5/market/candles',
  '/api/v5/market/history-candles',
  '/api/v5/public/instruments',
])

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

/**
 * OKX runs separate regional entities, and a key only exists on the one where
 * the account lives. Hitting the wrong domain yields "API key doesn't exist",
 * which reads like a bad copy-paste — so name the real cause.
 */
function regionHint(code: string, base: string): string {
  if (code === '50119' || code === '50111') {
    return ` — la clave no existe en ${new URL(base).host}. Tu cuenta puede estar en otra entidad regional: prueba a definir OKX_BASE_URL como https://eea.okx.com (Europa) o https://app.okx.com (EE. UU.).`
  }
  if (code === '50101') {
    return ' — la clave es de un entorno distinto: cambia OKX_SIMULATED (1 para la cuenta demo, vacío para la real).'
  }
  return ''
}

/** Constant-time string compare that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Optional shared-secret gate. When APP_ACCESS_TOKEN is set, every request must
 * carry it in `x-app-token`. Strongly recommended: a Vercel URL is public, and
 * without this anyone who finds it can read your portfolio.
 */
export function checkAccess(request: Request): Response | null {
  const expected = process.env.APP_ACCESS_TOKEN
  if (!expected) return null
  const provided = request.headers.get('x-app-token') ?? ''
  if (!safeEqual(provided, expected)) {
    return json({ error: 'unauthorized', message: 'Token de acceso inválido.' }, 401)
  }
  return null
}

/** Whether the server has credentials configured at all. */
export function hasCredentials(): boolean {
  return Boolean(
    process.env.OKX_API_KEY && process.env.OKX_API_SECRET && process.env.OKX_API_PASSPHRASE,
  )
}

/**
 * Sign and forward a GET request. `path` must start with `/api/v5/` and may
 * carry a query string — OKX signs the path and query together, so the string
 * we sign has to be byte-identical to the one we send.
 */
export async function proxyOkxGet(path: string): Promise<Response> {
  if (!path.startsWith('/api/v5/')) {
    return json({ error: 'bad_request', message: 'La ruta debe empezar por /api/v5/.' }, 400)
  }

  const [pathname, search = ''] = path.split('?')
  if (!ALLOWED_PATHS.has(pathname)) {
    return json(
      { error: 'forbidden', message: `Endpoint no permitido: ${pathname}` },
      403,
    )
  }

  const { OKX_API_KEY, OKX_API_SECRET, OKX_API_PASSPHRASE } = process.env
  if (!OKX_API_KEY || !OKX_API_SECRET || !OKX_API_PASSPHRASE) {
    return json(
      {
        error: 'not_configured',
        message:
          'Faltan credenciales. Define OKX_API_KEY, OKX_API_SECRET y OKX_API_PASSPHRASE.',
      },
      503,
    )
  }

  const base = process.env.OKX_BASE_URL || 'https://www.okx.com'
  const requestPath = search ? `${pathname}?${search}` : pathname
  const timestamp = new Date().toISOString()
  const signature = createHmac('sha256', OKX_API_SECRET)
    .update(`${timestamp}GET${requestPath}`)
    .digest('base64')

  const headers: Record<string, string> = {
    'OK-ACCESS-KEY': OKX_API_KEY,
    'OK-ACCESS-SIGN': signature,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': OKX_API_PASSPHRASE,
    'Content-Type': 'application/json',
  }
  if (process.env.OKX_SIMULATED === '1') headers['x-simulated-trading'] = '1'

  let upstream: Response
  try {
    upstream = await fetch(`${base}${requestPath}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return json({ error: 'upstream_unreachable', message }, 502)
  }

  const text = await upstream.text()

  // OKX answers 200 with a non-zero `code` for business errors; surface those as
  // errors so the UI does not render an empty table as if it were success.
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return json({ error: 'bad_upstream_response', message: text.slice(0, 500) }, 502)
  }

  const body = payload as { code?: string; msg?: string }
  if (body?.code && body.code !== '0') {
    return json(
      {
        error: 'okx_error',
        code: body.code,
        message: `${body.msg || 'Error de OKX'}${regionHint(body.code, base)}`,
      },
      upstream.ok ? 400 : upstream.status,
    )
  }

  return new Response(text, {
    status: upstream.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/** Shared entry point used by both the Vercel function and the Vite dev server. */
export async function handleOkxRequest(request: Request): Promise<Response> {
  const denied = checkAccess(request)
  if (denied) return denied

  const url = new URL(request.url)

  if (url.searchParams.get('probe') === '1') {
    return json({ configured: hasCredentials(), simulated: process.env.OKX_SIMULATED === '1' }, 200)
  }

  const path = url.searchParams.get('path')
  if (!path) {
    return json({ error: 'bad_request', message: 'Falta el parámetro `path`.' }, 400)
  }

  return proxyOkxGet(path)
}
