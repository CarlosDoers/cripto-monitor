import { createHash, randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { allowedRedirect, checkMcpAuth, handleOauth } from './_oauth.js'

const TOKEN = 'm'.repeat(64)
const PASSWORD = 'p'.repeat(64)
const BASE = 'https://monitor.example'
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
const env = { ...process.env }

beforeEach(() => {
  process.env.MCP_TOKEN = TOKEN
  process.env.APP_ACCESS_TOKEN = PASSWORD
})
afterEach(() => {
  process.env = { ...env }
})

const call = (path: string, init?: RequestInit) => handleOauth(new Request(`${BASE}${path}`, init))
const form = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
})

async function registerClient(uris = [REDIRECT]) {
  const res = await call('/api/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: uris }),
  })
  return { res, body: (await res.json()) as { client_id: string } }
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

/** Register, consent with the password, return the code and what produced it. */
async function authorize(password = PASSWORD) {
  const { body } = await registerClient()
  const { verifier, challenge } = pkce()
  const params = {
    client_id: body.client_id,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    scope: 'read',
  }
  const res = await call('/api/oauth/authorize', form({ ...params, password }))
  const location = res.headers.get('location')
  const code = location ? new URL(location).searchParams.get('code') : null
  return { res, code, verifier, clientId: body.client_id, location }
}

describe('discovery', () => {
  it('serves both metadata documents with absolute URLs on this host', async () => {
    const resource = await (await call('/.well-known/oauth-protected-resource')).json()
    expect(resource.resource).toBe(`${BASE}/api/mcp`)
    expect(resource.authorization_servers).toEqual([BASE])
    const meta = await (await call('/.well-known/oauth-authorization-server')).json()
    expect(meta.issuer).toBe(BASE)
    expect(meta.token_endpoint).toBe(`${BASE}/api/oauth/token`)
    expect(meta.code_challenge_methods_supported).toEqual(['S256'])
  })

  it('points an unauthenticated connector call at the metadata', () => {
    const res = checkMcpAuth(new Request(`${BASE}/api/mcp`, { method: 'POST' }))!
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain(`${BASE}/.well-known/oauth-protected-resource`)
  })
})

describe('registration', () => {
  it('registers claude.ai', async () => {
    const { res, body } = await registerClient()
    expect(res.status).toBe(201)
    expect(body.client_id).toContain('.')
  })

  it('refuses a redirect anywhere else, which would phish the password', async () => {
    const { res } = await registerClient(['https://evil.example/callback'])
    expect(res.status).toBe(400)
    expect(allowedRedirect('https://claude.ai.evil.example/x')).toBe(false)
    expect(allowedRedirect('http://localhost:6274/callback')).toBe(true)
  })
})

describe('authorization code with PKCE', () => {
  it('shows a consent page that asks for the password', async () => {
    const { body } = await registerClient()
    const { challenge } = pkce()
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: body.client_id,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 's',
    })
    const res = await call(`/api/oauth/authorize?${q}`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Contraseña de la app')
    expect(res.headers.get('content-security-policy')).toContain('form-action \'self\' https://claude.ai')
  })

  it('refuses a wrong password', async () => {
    const { res, code } = await authorize('wrong')
    expect(res.status).toBe(401)
    expect(code).toBeNull()
  })

  it('exchanges the code for tokens the connector accepts', async () => {
    const { res, code, verifier, clientId, location } = await authorize()
    expect(res.status).toBe(302)
    expect(new URL(location!).searchParams.get('state')).toBe('xyz')
    const tokens = await (
      await call('/api/oauth/token', form({ grant_type: 'authorization_code', code: code!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier }))
    ).json()
    expect(tokens.token_type).toBe('Bearer')
    const mcp = new Request(`${BASE}/api/mcp`, { method: 'POST', headers: { authorization: `Bearer ${tokens.access_token}` } })
    expect(checkMcpAuth(mcp)).toBeNull()

    // And the refresh token gets a new access token.
    const refreshed = await (
      await call('/api/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }))
    ).json()
    expect(checkMcpAuth(new Request(`${BASE}/api/mcp`, { headers: { authorization: `Bearer ${refreshed.access_token}` } }))).toBeNull()
  })

  it('refuses the code without the right verifier', async () => {
    const { code, clientId } = await authorize()
    const res = await call('/api/oauth/token', form({ grant_type: 'authorization_code', code: code!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: 'nope' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_grant')
  })

  it('refuses a token as a different kind of token', async () => {
    const { code } = await authorize()
    // A code is not an access token, however well signed.
    expect(checkMcpAuth(new Request(`${BASE}/api/mcp`, { headers: { authorization: `Bearer ${code}` } }))?.status).toBe(401)
  })

  it('revokes everything when MCP_TOKEN changes', async () => {
    const { code, verifier, clientId } = await authorize()
    const tokens = await (
      await call('/api/oauth/token', form({ grant_type: 'authorization_code', code: code!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier }))
    ).json()
    process.env.MCP_TOKEN = 'n'.repeat(64)
    expect(checkMcpAuth(new Request(`${BASE}/api/mcp`, { headers: { authorization: `Bearer ${tokens.access_token}` } }))?.status).toBe(401)
  })
})

describe('the connector gate', () => {
  it('is off without a long enough MCP_TOKEN', () => {
    process.env.MCP_TOKEN = 'short'
    expect(checkMcpAuth(new Request(`${BASE}/api/mcp?token=short`))?.status).toBe(503)
  })

  it('still accepts the key in the URL or as a bearer, for the connector added before OAuth', () => {
    expect(checkMcpAuth(new Request(`${BASE}/api/mcp?token=${TOKEN}`))).toBeNull()
    expect(checkMcpAuth(new Request(`${BASE}/api/mcp`, { headers: { authorization: `Bearer ${TOKEN}` } }))).toBeNull()
    expect(checkMcpAuth(new Request(`${BASE}/api/mcp?token=wrong`))?.status).toBe(401)
  })
})
