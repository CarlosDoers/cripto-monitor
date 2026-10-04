import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * OAuth 2.1 for the claude.ai connector, so its URL no longer has to carry the
 * key. claude.ai finds this server by itself: `/api/mcp` answers 401 with a
 * pointer to the protected-resource metadata, which names this server, which
 * lists its endpoints; claude.ai registers itself, sends the user to a consent
 * page that asks for the app's password, and from then on calls `/api/mcp`
 * with a bearer token it refreshes on its own.
 *
 * **No database.** Vercel functions keep no state, and an OAuth server usually
 * needs a table of clients, codes and tokens. Here each of those is a signed
 * message instead: `<payload>.<HMAC>` with a key derived from `MCP_TOKEN`. The
 * server recognises its own signature and needs nothing else. Two consequences,
 * both chosen: rotating `MCP_TOKEN` revokes every client and token at once (the
 * kill switch), and a code can be replayed within its five minutes — which is
 * why PKCE is required, so a stolen code is useless without the verifier only
 * the client holds.
 *
 * Only claude.ai / claude.com (and localhost, for testing with a local client)
 * may receive a code: a link that sent the consent page's result anywhere else
 * would be a way to phish the password.
 */

const ACCESS_TTL = 60 * 60 // 1 h
const REFRESH_TTL = 30 * 24 * 60 * 60 // 30 days
const CODE_TTL = 5 * 60

const b64url = (data: Buffer | string) => Buffer.from(data).toString('base64url')

function key(): Buffer | null {
  const secret = process.env.MCP_TOKEN ?? ''
  return secret.length >= 32 ? createHmac('sha256', secret).update('oauth-v1').digest() : null
}

type Kind = 'client' | 'code' | 'access' | 'refresh'
type Signed = { typ: Kind; exp?: number } & Record<string, unknown>

function sign(payload: Signed): string {
  const k = key()
  if (!k) throw new Error('MCP_TOKEN missing')
  const body = b64url(JSON.stringify(payload))
  return `${body}.${createHmac('sha256', k).update(body).digest('base64url')}`
}

function verify<T extends Signed>(token: string | null | undefined, typ: Kind): T | null {
  const k = key()
  if (!k || !token) return null
  const [body, mac] = token.split('.')
  if (!body || !mac) return null
  const expected = createHmac('sha256', k).update(body).digest()
  const given = Buffer.from(mac, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as T
    if (payload.typ !== typ) return null
    if (payload.exp !== undefined && payload.exp < Date.now() / 1000) return null
    return payload
  } catch {
    return null
  }
}

/** Tokens name their client by a hash of its id, not the id itself. */
const clientRef = (clientId: string) => createHash('sha256').update(clientId).digest('base64url').slice(0, 22)

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Where a code may be sent. */
export function allowedRedirect(uri: string): boolean {
  try {
    const u = new URL(uri)
    if (u.protocol === 'https:' && ['claude.ai', 'claude.com'].includes(u.hostname)) return true
    return u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)
  } catch {
    return false
  }
}

// ── responses ────────────────────────────────────────────────────────────────

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
  })

const oauthError = (error: string, description: string, status = 400) =>
  json({ error, error_description: description }, status)

const origin = (request: Request) => new URL(request.url).origin

export function resourceMetadata(request: Request) {
  const base = origin(request)
  return {
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    scopes_supported: ['read'],
    bearer_methods_supported: ['header'],
    resource_name: 'Cripto Monitor',
  }
}

export function serverMetadata(request: Request) {
  const base = origin(request)
  return {
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['read'],
  }
}

// ── the gate on /api/mcp ─────────────────────────────────────────────────────

/**
 * Who may call the connector: a bearer token this server issued, or — so the
 * connector added before OAuth keeps working — `MCP_TOKEN` itself, in the URL
 * or as a bearer. Off without a `MCP_TOKEN` of at least 32 characters. A
 * refusal carries `WWW-Authenticate` with the metadata URL, which is how
 * claude.ai discovers that it should start OAuth.
 */
export function checkMcpAuth(request: Request): Response | null {
  const secret = process.env.MCP_TOKEN ?? ''
  if (secret.length < 32) {
    return json({ error: 'mcp_disabled', message: 'El conector está desactivado: define MCP_TOKEN (32 caracteres o más).' }, 503)
  }
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  const legacy = bearer ?? new URL(request.url).searchParams.get('token') ?? ''
  if (legacy && safeEqual(legacy, secret)) return null
  if (bearer && verify(bearer, 'access')) return null
  return new Response(JSON.stringify({ error: 'unauthorized', message: 'Falta autorización para el conector.' }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'www-authenticate': `Bearer resource_metadata="${origin(request)}/.well-known/oauth-protected-resource"`,
      ...CORS,
    },
  })
}

// ── endpoints ────────────────────────────────────────────────────────────────

async function readForm(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get('content-type') ?? ''
  if (type.includes('application/json')) return (await request.json()) as Record<string, string>
  return Object.fromEntries(new URLSearchParams(await request.text()))
}

/** RFC 7591 dynamic registration: the client id *is* its signed registration. */
async function register(request: Request): Promise<Response> {
  if (!key()) return oauthError('temporarily_unavailable', 'El conector está desactivado.', 503)
  let body: { redirect_uris?: unknown; client_name?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return oauthError('invalid_client_metadata', 'El registro debe ser JSON.')
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === 'string') : []
  if (uris.length === 0 || !uris.every(allowedRedirect)) {
    return oauthError('invalid_redirect_uri', 'Solo se admiten direcciones de vuelta de claude.ai, claude.com o localhost.')
  }
  const issuedAt = Math.floor(Date.now() / 1000)
  const clientId = sign({ typ: 'client', uris, iat: issuedAt })
  return json(
    {
      client_id: clientId,
      client_id_issued_at: issuedAt,
      client_name: typeof body.client_name === 'string' ? body.client_name : undefined,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    201,
  )
}

interface AuthorizeParams {
  client_id: string
  redirect_uri: string
  code_challenge: string
  code_challenge_method: string
  state: string
  scope: string
}

/** The request is one this server can honour; otherwise why not, in Spanish. */
function checkAuthorize(p: Partial<AuthorizeParams>): string | null {
  const client = verify<Signed & { uris: string[] }>(p.client_id, 'client')
  if (!client) return 'Cliente desconocido: vuelve a añadir el conector en claude.ai.'
  if (!p.redirect_uri || !client.uris.includes(p.redirect_uri) || !allowedRedirect(p.redirect_uri)) {
    return 'La dirección de vuelta no es la que se registró.'
  }
  if (!p.code_challenge || p.code_challenge_method !== 'S256') return 'Falta PKCE (S256).'
  return null
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** The consent page. Plain HTML, styled inline, no script. */
function consentPage(p: AuthorizeParams, error?: string): Response {
  const hidden = (Object.keys(p) as (keyof AuthorizeParams)[])
    .map((k) => `<input type="hidden" name="${k}" value="${escape(p[k] ?? '')}">`)
    .join('')
  const target = new URL(p.redirect_uri)
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Autorizar a Claude · Cripto Monitor</title>
<style>
:root{color-scheme:light dark;--bg:#f4f6fb;--fg:#0d1117;--muted:#5b6474;--line:#d5dae3;--accent:#4338ca;--bad:#c2183b}
@media (prefers-color-scheme:dark){:root{--bg:#07090e;--fg:#e6e9ef;--muted:#8b94a5;--line:#232a36;--accent:#818cf8;--bad:#f87171}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"IBM Plex Sans",sans-serif;padding:16px}
main{width:min(440px,100%);border:1px solid var(--line);padding:28px}
h1{font-size:18px;margin:0 0 10px}p{margin:0 0 14px;color:var(--muted)}strong{color:var(--fg)}
label{display:block;font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:18px 0 6px}
input[type=password]{width:100%;padding:10px;border:1px solid var(--line);background:transparent;color:var(--fg);font:14px ui-monospace,monospace}
button{margin-top:16px;width:100%;padding:11px;border:0;background:var(--accent);color:#fff;font-weight:600;font-size:14px;cursor:pointer}
.err{color:var(--bad);margin-top:12px}ul{margin:0 0 14px;padding-left:18px;color:var(--muted)}
</style></head><body><main>
<h1>Autorizar a Claude</h1>
<p><strong>${escape(target.host)}</strong> pide leer tu cuenta de OKX a través de Cripto Monitor.</p>
<ul><li>Solo lectura: no puede operar, transferir ni retirar.</li><li>Puedes revocarlo cambiando <code>MCP_TOKEN</code> en Vercel.</li></ul>
<form method="post" action="/api/oauth/authorize">${hidden}
<label for="password">Contraseña de la app</label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
${error ? `<p class="err">${escape(error)}</p>` : ''}
<button type="submit">Autorizar</button>
</form></main></body></html>`
  return new Response(html, {
    status: error ? 401 : 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // The form posts here and the answer redirects to claude.ai: form-action
      // has to allow both, or the browser blocks the redirect after submitting.
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${target.origin}; frame-ancestors 'none'; base-uri 'none'`,
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
    },
  })
}

function errorPage(message: string): Response {
  return new Response(`<!doctype html><meta charset="utf-8"><title>Cripto Monitor</title><p style="font:15px system-ui;padding:24px">${escape(message)}</p>`, {
    status: 400,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

async function authorize(request: Request): Promise<Response> {
  if (!key()) return errorPage('El conector está desactivado: falta MCP_TOKEN en el servidor.')
  const fields = request.method === 'POST' ? await readForm(request) : Object.fromEntries(new URL(request.url).searchParams)
  const p: AuthorizeParams = {
    client_id: fields.client_id ?? '',
    redirect_uri: fields.redirect_uri ?? '',
    code_challenge: fields.code_challenge ?? '',
    code_challenge_method: fields.code_challenge_method ?? '',
    state: fields.state ?? '',
    scope: fields.scope ?? 'read',
  }
  const problem = checkAuthorize(p)
  // Before the redirect URI is trusted, an error can only be shown, never sent.
  if (problem) return errorPage(problem)
  if (request.method !== 'POST') {
    if (fields.response_type !== 'code') return errorPage('Solo se admite response_type=code.')
    return consentPage(p)
  }

  // The app's own password; without one set, the connector key itself.
  const password = process.env.APP_ACCESS_TOKEN || process.env.MCP_TOKEN || ''
  if (!safeEqual(fields.password ?? '', password)) return consentPage(p, 'Contraseña incorrecta.')

  const code = sign({
    typ: 'code',
    client: clientRef(p.client_id),
    redirect_uri: p.redirect_uri,
    challenge: p.code_challenge,
    exp: Math.floor(Date.now() / 1000) + CODE_TTL,
  })
  const back = new URL(p.redirect_uri)
  back.searchParams.set('code', code)
  if (p.state) back.searchParams.set('state', p.state)
  return new Response(null, { status: 302, headers: { location: back.toString(), 'cache-control': 'no-store' } })
}

function issue(client: string): Response {
  const now = Math.floor(Date.now() / 1000)
  return json({
    access_token: sign({ typ: 'access', client, exp: now + ACCESS_TTL }),
    token_type: 'Bearer',
    expires_in: ACCESS_TTL,
    refresh_token: sign({ typ: 'refresh', client, exp: now + REFRESH_TTL }),
    scope: 'read',
  })
}

async function token(request: Request): Promise<Response> {
  if (!key()) return oauthError('temporarily_unavailable', 'El conector está desactivado.', 503)
  const f = await readForm(request)
  const client = f.client_id ? clientRef(f.client_id) : ''
  if (!verify(f.client_id, 'client')) return oauthError('invalid_client', 'Cliente desconocido.', 401)

  if (f.grant_type === 'authorization_code') {
    const code = verify<Signed & { client: string; redirect_uri: string; challenge: string }>(f.code, 'code')
    if (!code || code.client !== client) return oauthError('invalid_grant', 'Código caducado o de otro cliente.')
    if (f.redirect_uri !== code.redirect_uri) return oauthError('invalid_grant', 'La dirección de vuelta no coincide.')
    const challenge = createHash('sha256').update(f.code_verifier ?? '').digest('base64url')
    if (!f.code_verifier || !safeEqual(challenge, code.challenge)) return oauthError('invalid_grant', 'PKCE no coincide.')
    return issue(client)
  }
  if (f.grant_type === 'refresh_token') {
    const refresh = verify<Signed & { client: string }>(f.refresh_token, 'refresh')
    if (!refresh || refresh.client !== client) return oauthError('invalid_grant', 'Token de refresco caducado o de otro cliente.')
    return issue(client)
  }
  return oauthError('unsupported_grant_type', 'Solo authorization_code y refresh_token.')
}

/**
 * Which endpoint a request is for. Vercel rewrites the public paths onto
 * `/api/oauth?step=`, and the path is read too in case a rewrite hands the
 * function its original URL.
 */
function stepOf(url: URL): string | null {
  const explicit = url.searchParams.get('step')
  if (explicit) return explicit
  if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) return 'resource'
  if (url.pathname.startsWith('/.well-known/oauth-authorization-server')) return 'metadata'
  if (url.pathname.startsWith('/.well-known/openid-configuration')) return 'metadata'
  return url.pathname.match(/^\/api\/oauth\/([a-z]+)/)?.[1] ?? null
}

/** Every OAuth route, by step. */
export async function handleOauth(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const step = stepOf(new URL(request.url))
  switch (step) {
    case 'resource':
      return json(resourceMetadata(request))
    case 'metadata':
      return json(serverMetadata(request))
    case 'register':
      return request.method === 'POST' ? register(request) : oauthError('invalid_request', 'Usa POST.', 405)
    case 'authorize':
      return authorize(request)
    case 'token':
      return request.method === 'POST' ? token(request) : oauthError('invalid_request', 'Usa POST.', 405)
    default:
      return json({ error: 'not_found' }, 404)
  }
}
