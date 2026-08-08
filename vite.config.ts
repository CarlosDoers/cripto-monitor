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
        if (!req.url?.startsWith('/api/okx')) return next()
        void serve(server, req, res)
      })
    },
  }
}

async function serve(server: ViteDevServer, req: IncomingMessage, res: ServerResponse) {
  try {
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(key, value)
      else if (Array.isArray(value)) headers.set(key, value.join(', '))
    }

    // ssrLoadModule keeps the handler hot-reloadable while editing api/.
    const mod = (await server.ssrLoadModule('/api/okx.ts')) as {
      default: { fetch(request: Request): Promise<Response> }
    }

    const response = await mod.default.fetch(
      new Request(`http://localhost${req.url}`, { method: req.method ?? 'GET', headers }),
    )

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
