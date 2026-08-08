/**
 * Stable colour assignment.
 *
 * Colour follows the entity, never its rank: if BTC drops from first to second
 * place it must keep its hue, or a reader who learned "BTC is blue" is misled.
 * So slots are handed out per-currency and remembered, rather than derived from
 * the sort order.
 *
 * Only the currencies that get their own segment in the allocation chart take a
 * hue. Everything past that folds into "Otros" and stays grey — in the chart and
 * in the tables alike, so the two always agree. There is no 9th hue: a generated
 * one would be indistinguishable from an existing slot under CVD.
 */

const SLOTS = 8
/** Chart segments before the tail folds into "Otros". One slot of headroom. */
export const VISIBLE = 7
const STORE_KEY = 'cripto-monitor:colors'

interface Assignment {
  slot: number
  lastSeen: number
}

type Registry = Record<string, Assignment>

let registry: Registry | null = null

function load(): Registry {
  if (registry) return registry
  try {
    const raw = localStorage.getItem(STORE_KEY)
    registry = raw ? (JSON.parse(raw) as Registry) : {}
  } catch {
    registry = {}
  }
  return registry
}

function persist(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(registry))
  } catch {
    // A full or unavailable localStorage is not worth failing a render over.
  }
}

export const OTHER_COLOR = 'var(--series-other)'

const slotVar = (slot: number) => `var(--series-${slot + 1})`

/**
 * Hands the currency a slot, reusing the one it already has. Only called for
 * the visible set, so at most VISIBLE slots are live at once and the recycling
 * below cannot thrash.
 */
function claim(ccy: string, now: number): string {
  const reg = load()

  const existing = reg[ccy]
  if (existing) {
    existing.lastSeen = now
    return slotVar(existing.slot)
  }

  const taken = new Set(Object.values(reg).map((a) => a.slot))
  let slot = -1
  for (let i = 0; i < SLOTS; i++) {
    if (!taken.has(i)) {
      slot = i
      break
    }
  }

  // All slots spoken for: the least recently seen currency has dropped out of
  // the visible set, so it gives up its hue.
  if (slot === -1) {
    let oldestCcy = ''
    let oldest = Infinity
    for (const [key, assignment] of Object.entries(reg)) {
      if (assignment.lastSeen < oldest) {
        oldest = assignment.lastSeen
        oldestCcy = key
      }
    }
    slot = reg[oldestCcy].slot
    delete reg[oldestCcy]
  }

  reg[ccy] = { slot, lastSeen: now }
  return slotVar(slot)
}

/**
 * The colour map for one ordered list of currencies (highest value first).
 * Deterministic for a given list, so every view that renders the same holdings
 * paints them the same way.
 */
export function assignColors(orderedCcys: string[]): Map<string, string> {
  const now = Date.now()
  const map = new Map<string, string>()

  for (const ccy of orderedCcys.slice(0, VISIBLE)) {
    map.set(ccy, claim(ccy, now))
  }
  persist()

  for (const ccy of orderedCcys.slice(VISIBLE)) {
    map.set(ccy, OTHER_COLOR)
  }
  return map
}

/**
 * Reads a currency's colour without claiming a slot — for views (bills, fills)
 * that show currencies outside any ranked set. Unknown currencies stay grey.
 */
export function colorOf(ccy: string): string {
  const assignment = load()[ccy]
  return assignment ? slotVar(assignment.slot) : OTHER_COLOR
}
