import { isCron } from './_cron.js'
import { ledgerStorage, ledgerStore } from './_ledger.js'
import { checkAccess } from './_okx.js'
import type { Get, RunOptions, RunResult, TestResult } from './_watch.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export interface WatchDeps {
  runWatch(options: RunOptions): Promise<RunResult>
  describeWatch(env: Record<string, string | undefined>): Record<string, unknown>
  sendTest(env: Record<string, string | undefined>, appUrl?: string): Promise<TestResult>
  /** The signed, allowlisted OKX read. */
  get: Get
}

/**
 * The tracking ledger's endpoint (`src/lib/watchJob.ts` does the work).
 *
 *   GET  /api/watch            → the ledger and the configuration, for the app
 *                                (behind its password); `?meta=1` answers with
 *                                when it last ran and how big it is, no more
 *   POST /api/watch            → a pass now, from the app when it opens; the job
 *                                skips it when one just ran
 *   GET  /api/watch?run=cron   → a pass from a scheduler (Vercel's daily cron, a
 *                                GitHub workflow), authenticated by CRON_SECRET
 *   POST /api/watch?notify=test → a message that is not a signal through every
 *                                configured channel (the app's "Probar aviso"),
 *                                behind the password; it runs no pass
 *
 * The job and its bundle are injected: in production `api/watch.ts` passes the
 * bundle `npm run build` writes, in development `vite.config.ts` passes the
 * source, which is never stale.
 */
export function createWatchHandler(deps: WatchDeps) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const env = process.env
    const config = deps.describeWatch(env)
    const appUrl = env.APP_URL || url.origin

    // A test of the channels needs no ledger, so it is answered before the store is looked at.
    if (request.method === 'POST' && url.searchParams.get('notify') === 'test') {
      const denied = checkAccess(request)
      if (denied) return denied
      return json({ test: await deps.sendTest(env, appUrl) })
    }

    const store = ledgerStore()
    if (!store) return json({ enabled: false, ledger: null, config })

    const cron = url.searchParams.get('run') === 'cron'
    if (cron) {
      if (!isCron(request)) return json({ error: 'unauthorized' }, 401)
    } else {
      const denied = checkAccess(request)
      if (denied) return denied
    }

    try {
      if (cron || request.method === 'POST') {
        // `?dry=1&pretend=72`: compute what the ledger would have recorded had it begun 72 hours ago,
        // and write and tell nobody. A way to see the job work on live data before trusting it.
        const dry = url.searchParams.get('dry') === '1'
        const pretend = Number(url.searchParams.get('pretend'))
        const result = await deps.runWatch({
          get: deps.get,
          store,
          env,
          // Where the links in a notification point: the address this request came to, unless told otherwise.
          appUrl,
          dry,
          pretendStart: dry && pretend > 0 ? Date.now() - Math.min(pretend, 24 * 30) * 3_600_000 : undefined,
          force: url.searchParams.get('force') === '1' && cron,
        })
        const { ledger, ...summary } = result
        return json({ enabled: true, storage: ledgerStorage(), run: summary, ledger, config }, result.status === 'failed' ? 502 : 200)
      }
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
      const read = await store.read()
      // `?meta=1`: when the ledger was last run and how big it is, without the ledger. The app asks this every
      // hour from whichever view is open, and the whole file is megabytes.
      if (url.searchParams.get('meta') === '1') {
        const l = (read.ledger ?? {}) as { startedAt?: number; lastRun?: number; runs?: number; entries?: unknown[]; lockUntil?: number }
        return json({
          enabled: true,
          storage: ledgerStorage(),
          config,
          meta: {
            exists: read.ledger !== null,
            startedAt: l.startedAt ?? 0,
            lastRun: l.lastRun ?? 0,
            runs: l.runs ?? 0,
            entries: Array.isArray(l.entries) ? l.entries.length : 0,
            lockUntil: l.lockUntil ?? null,
          },
          now: Date.now(),
        })
      }
      return json({ enabled: true, storage: ledgerStorage(), ledger: read.ledger, config, now: Date.now() })
    } catch (err) {
      return json({ error: 'watch_failed', message: err instanceof Error ? err.message : String(err) }, 502)
    }
  }
}
