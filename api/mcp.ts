import { checkMcpAuth } from './_oauth.js'
import { okxData } from './_okx.js'
import { handleMcp } from './_mcp.js'

/**
 * The claude.ai connector, a read-only Model Context Protocol server. The
 * server itself is `src/lib/mcp.ts`; `_mcp.js` is that file bundled by
 * `npm run build`, because Vercel compiles each file under `api/` on its own
 * and the app's extensionless imports would not resolve at runtime. Vercel
 * runs the build command before it compiles functions, so the bundle is there
 * when this file is traced.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    return checkMcpAuth(request) ?? handleMcp(request, okxData)
  },
}
