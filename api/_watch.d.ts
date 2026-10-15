/**
 * Types for `api/_watch.js`, the bundle `npm run build` writes from
 * `src/lib/watchJob.ts` (see `scripts/build-mcp.mjs`). Self-contained on
 * purpose, like `_mcp.d.ts`: `api/` is typechecked with Node's module
 * resolution, which cannot follow the app's extensionless imports. The
 * implementation is typed against these declarations, so the two cannot drift.
 */

export type Get = <T>(path: string, params?: Record<string, string | number | undefined>) => Promise<T[]>

/**
 * Where the ledger lives. `token` is whatever the store uses to detect that
 * someone else wrote in between (a blob's ETag): a write made with a token that
 * is no longer current is refused, and the run reads again and folds its work in.
 */
export interface LedgerStore {
  read(): Promise<{ ledger: unknown; token: string | null }>
  write(ledger: unknown, token: string | null): Promise<{ ok: boolean; token: string | null }>
}

export interface RunOptions {
  get: Get
  store: LedgerStore
  /** Environment: the channels, and `WATCH_*`. Passed in, not read, so a test controls it. */
  env: Record<string, string | undefined>
  /** The app's own address, for the links in a notification. */
  appUrl?: string
  /** Skip the two guards (a run just finished, another in progress): the daily cron. */
  force?: boolean
  /** Compute and report; write nothing and tell nobody. */
  dry?: boolean
  /** With `dry`: pretend the ledger began at this time, to see what it would have recorded since. */
  pretendStart?: number
  now?: number
}

export interface RunResult {
  status: 'ran' | 'skipped' | 'failed'
  reason?: string
  tracks: string[]
  scanned: number
  added: number
  closed: number
  alerts: { sent: number; failed: number; channels: string[] }
  errors: string[]
  ms: number
  /** The ledger as it stands after the run (before it, when skipped). Opaque to the function. */
  ledger: unknown
}

export function runWatch(options: RunOptions): Promise<RunResult>

export function describeWatch(env: Record<string, string | undefined>): {
  channels: string[]
  top: number
  bars: string[]
  alertBars: string[]
  alertSides: string[]
}
