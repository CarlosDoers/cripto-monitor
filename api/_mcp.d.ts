/**
 * Types for `api/_mcp.js`, the bundle `npm run build` writes from
 * `src/lib/mcp.ts` (see `scripts/build-mcp.mjs`). The implementation is typed
 * against these declarations, so the two cannot drift apart unnoticed.
 */

export type Get = <T>(path: string, params?: Record<string, string | number | undefined>) => Promise<T[]>

/** What the server can give a tool besides OKX: the tracking ledger it keeps, read on demand. */
export interface McpExtras {
  ledger?: () => Promise<unknown>
}

export function handleMcp(request: Request, get: Get, extras?: McpExtras): Promise<Response>
