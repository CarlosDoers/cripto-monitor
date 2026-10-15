import { createWatchHandler } from './_watchHandler.js'
import { okxData } from './_okx.js'
import { describeWatch, runWatch } from './_watch.js'

/**
 * The tracking ledger's endpoint. The job is `src/lib/watchJob.ts`; `_watch.js`
 * is that file bundled by `npm run build`, for the same reason `_mcp.js` is:
 * Vercel compiles each file under `api/` on its own and the app's extensionless
 * imports would not resolve at runtime.
 */
const handler = createWatchHandler({ runWatch, describeWatch, get: okxData })

export default {
  fetch: (request: Request): Promise<Response> => handler(request),
}
