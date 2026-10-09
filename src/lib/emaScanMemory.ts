/**
 * What the EMA touch scan found last time, kept in this browser so the next
 * scan can say what changed: who touches now that did not, and who no longer
 * does. That is all it is for — a convenience for the person looking, not state
 * anything depends on, so every access is guarded and the card renders the same
 * with no storage at all (private window, blocked site data, a full quota).
 *
 * One record per set of settings. Comparing a top-10 scan with a top-20 one, or
 * a 3-candle window with a 10-day one, would report differences that are only
 * the settings.
 */

export interface ScanRecord {
  /** When the scan finished. */
  at: number
  /** Every contract it looked at. */
  scanned: string[]
  /** Those that touched inside its window. */
  hits: string[]
}

export interface ScanSettings {
  length: number
  bar: string
  window: number
  size: number
  cryptoOnly: boolean
}

/** The bits of `Storage` used, so a test can hand in a plain object. */
export type ScanStore = Pick<Storage, 'getItem' | 'setItem'>

const KEY = 'ema-scan-v1'
/** Settings are free-form (any length from 5 to 60), so the record cannot grow without bound. */
const KEEP = 24

export const scanKey = (s: ScanSettings) => [s.length, s.bar, s.window, s.size, s.cryptoOnly ? 'c' : 't'].join('|')

function browserStore(): ScanStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every((v) => typeof v === 'string')

function parse(raw: string | null): Record<string, ScanRecord> {
  if (!raw) return {}
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    const out: Record<string, ScanRecord> = {}
    for (const [key, v] of Object.entries(data)) {
      const r = v as Partial<ScanRecord> | null
      // Anything that is not exactly a record is dropped rather than trusted.
      if (r && typeof r.at === 'number' && Number.isFinite(r.at) && strings(r.scanned) && strings(r.hits)) {
        out[key] = { at: r.at, scanned: r.scanned, hits: r.hits }
      }
    }
    return out
  } catch {
    return {}
  }
}

export function readScan(key: string, store: ScanStore | null = browserStore()): ScanRecord | null {
  if (!store) return null
  try {
    return parse(store.getItem(KEY))[key] ?? null
  } catch {
    return null
  }
}

/** Returns whether it was kept: false means the next scan will have nothing to compare with. */
export function writeScan(key: string, record: ScanRecord, store: ScanStore | null = browserStore()): boolean {
  if (!store) return false
  try {
    const all = parse(store.getItem(KEY))
    all[key] = record
    const newest = Object.entries(all)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, KEEP)
    store.setItem(KEY, JSON.stringify(Object.fromEntries(newest)))
    return true
  } catch {
    return false
  }
}

export interface ScanChanges {
  /** Touching now, and not at the previous scan. */
  fresh: string[]
  /** Touched at the previous scan, looked at again now, and no longer touching. */
  gone: string[]
  /** When the previous scan finished. */
  since: number
}

/**
 * What changed from `prev` to `now`. A contract that fell out of the list
 * (the ranking by volume moved) is neither new nor gone: it was not looked at,
 * so nothing is known about whether it still touches.
 */
export function diffScans(prev: ScanRecord | null, now: ScanRecord): ScanChanges | null {
  if (!prev) return null
  const before = new Set(prev.hits)
  const hit = new Set(now.hits)
  const looked = new Set(now.scanned)
  return {
    fresh: now.hits.filter((id) => !before.has(id)),
    gone: prev.hits.filter((id) => looked.has(id) && !hit.has(id)),
    since: prev.at,
  }
}
