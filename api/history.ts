import { timingSafeEqual } from 'node:crypto'
import { historyEnabled, measure, readHistory, record } from './_history.js'
import { checkAccess } from './_okx.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

/** Vercel's cron sends `Authorization: Bearer $CRON_SECRET`, and only when CRON_SECRET is set. */
function isCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? ''
  const given = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  return secret.length >= 16 && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}

/**
 * The net-worth history (`_history.ts`).
 *
 *   GET  /api/history              → the points, for the app (behind its password)
 *   POST /api/history              → record today's point now, from OKX (the app
 *                                    does this on opening when today has none)
 *   GET  /api/history?record=cron  → the daily cron, authenticated by CRON_SECRET
 */
export default {
  async fetch(request: Request): Promise<Response> {
    if (!historyEnabled()) return json({ enabled: false, points: [] })
    const cron = new URL(request.url).searchParams.get('record') === 'cron'
    if (cron) {
      if (!isCron(request)) return json({ error: 'unauthorized' }, 401)
    } else {
      const denied = checkAccess(request)
      if (denied) return denied
    }
    try {
      if (cron || request.method === 'POST') {
        const points = await record(await measure())
        return json({ enabled: true, points })
      }
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
      return json({ enabled: true, points: await readHistory() })
    } catch (err) {
      return json({ error: 'history_failed', message: err instanceof Error ? err.message : String(err) }, 502)
    }
  },
}
