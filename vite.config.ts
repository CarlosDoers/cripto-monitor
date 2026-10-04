import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Runs the `api/` functions inside the Vite dev server so `npm run dev` behaves
 * like production without needing the Vercel CLI. Vercel serves these files
 * itself once deployed, so this plugin is dev-only.
 */
function apiDevServer(env: Record<string, string>): Plugin {
  return {
    name: 'okx-api-dev-server',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      // The api/ modules read credentials from process.env, exactly as they do
      // on Vercel. In dev they come from .env.local / .env.
      for (const [key, value] of Object.entries(env)) {
        if (!key.startsWith('VITE_') && process.env[key] === undefined) {
          process.env[key] = value
        }
      }

      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url ?? ''
        const ours = ['/api/okx', '/api/mcp', '/api/oauth', '/api/history', '/.well-known/oauth-', '/.well-known/openid-configuration']
        if (!ours.some((p) => url.startsWith(p))) return next()
        void serve(server, req, res)
      })
    },
  }
}

type Handler = (request: Request) => Promise<Response>

/**
 * ssrLoadModule keeps the handlers hot-reloadable while editing. The connector
 * is wired here from its source, `src/lib/mcp.ts`, rather than through
 * `api/mcp.ts`, which loads the bundle `npm run build` writes: in dev that
 * bundle would be stale or missing. The wiring is the same one line.
 */
function handlerFor(server: ViteDevServer, url: string): Handler {
  if (url.startsWith('/api/mcp')) {
    return async (request) => {
      const [okx, oauth, mcp] = (await Promise.all([
        server.ssrLoadModule('/api/_okx.ts'),
        server.ssrLoadModule('/api/_oauth.ts'),
        server.ssrLoadModule('/src/lib/mcp.ts'),
      ])) as [
        typeof import('./api/_okx.js'),
        typeof import('./api/_oauth.js'),
        { handleMcp: typeof import('./api/_mcp.js').handleMcp },
      ]
      return oauth.checkMcpAuth(request) ?? mcp.handleMcp(request, okx.okxData)
    }
  }
  if (url.startsWith('/api/history')) {
    return async (request) => {
      const mod = (await server.ssrLoadModule('/api/history.ts')) as { default: { fetch: Handler } }
      return mod.default.fetch(request)
    }
  }
  if (url.startsWith('/api/oauth') || url.startsWith('/.well-known/')) {
    return async (request) => {
      const oauth = (await server.ssrLoadModule('/api/_oauth.ts')) as typeof import('./api/_oauth.js')
      return oauth.handleOauth(request)
    }
  }
  return async (request) => {
    const mod = (await server.ssrLoadModule('/api/okx.ts')) as { default: { fetch: Handler } }
    return mod.default.fetch(request)
  }
}

async function serve(server: ViteDevServer, req: IncomingMessage, res: ServerResponse) {
  try {
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(key, value)
      else if (Array.isArray(value)) headers.set(key, value.join(', '))
    }

    const method = req.method ?? 'GET'
    const chunks: Buffer[] = []
    if (method !== 'GET' && method !== 'HEAD') for await (const chunk of req) chunks.push(chunk as Buffer)
    // The OAuth metadata names absolute URLs, so the request keeps its real host.
    const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, {
      method,
      headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    })

    const response = await handlerFor(server, req.url ?? '')(request)

    res.statusCode = response.status
    response.headers.forEach((value, key) => res.setHeader(key, value))
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (err) {
    res.statusCode = 500
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        error: 'dev_server_error',
        message: err instanceof Error ? err.message : String(err),
      }),
    )
  }
}

export default defineConfig(({ mode }) => {
  // The '' prefix loads every var, not just VITE_* — the api/ handler needs the
  // secrets, and they must never be exposed to the client bundle.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), apiDevServer(env)],
  }
})
