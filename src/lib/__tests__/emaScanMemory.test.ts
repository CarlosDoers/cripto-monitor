import { describe, expect, it } from 'vitest'
import { diffScans, readScan, scanKey, writeScan, type ScanRecord, type ScanStore } from '../emaScanMemory'

/** A `Storage` in a variable: vitest runs in node, where there is no localStorage. */
function memory(initial: Record<string, string> = {}): ScanStore & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v
    },
  }
}

const settings = { length: 25, bar: '1Dutc', window: 3, size: 20, cryptoOnly: true }
const record = (hits: string[], scanned = ['A', 'B', 'C', 'D'], at = 1_000): ScanRecord => ({ at, scanned, hits })

describe('scanKey', () => {
  it('differs when any setting differs, so unlike scans are never compared', () => {
    const keys = [
      scanKey(settings),
      scanKey({ ...settings, length: 50 }),
      scanKey({ ...settings, bar: '1D' }),
      scanKey({ ...settings, window: 10 }),
      scanKey({ ...settings, size: 10 }),
      scanKey({ ...settings, cryptoOnly: false }),
    ]
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('reading and writing the last scan', () => {
  it('returns what was written, per set of settings', () => {
    const store = memory()
    const k = scanKey(settings)
    const other = scanKey({ ...settings, window: 10 })
    expect(writeScan(k, record(['A']), store)).toBe(true)
    expect(writeScan(other, record(['B', 'C']), store)).toBe(true)
    expect(readScan(k, store)?.hits).toEqual(['A'])
    expect(readScan(other, store)?.hits).toEqual(['B', 'C'])
    expect(readScan(scanKey({ ...settings, length: 9 }), store)).toBeNull()
  })

  it('is the same card with no storage at all', () => {
    expect(readScan('k', null)).toBeNull()
    expect(writeScan('k', record([]), null)).toBe(false)
  })

  it('survives a store that throws on every call (blocked site data, full quota)', () => {
    const broken: ScanStore = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('full')
      },
    }
    expect(readScan('k', broken)).toBeNull()
    expect(writeScan('k', record([]), broken)).toBe(false)
  })

  it('ignores what is not a record rather than trusting it', () => {
    for (const bad of ['not json', '[]', 'null', '{"k":{"at":"x","scanned":[],"hits":[]}}', '{"k":{"at":1,"scanned":[1],"hits":[]}}', '{"k":{"at":1}}']) {
      expect(readScan('k', memory({ 'ema-scan-v1': bad }))).toBeNull()
    }
    // A bad entry beside a good one does not take the good one down.
    const store = memory({ 'ema-scan-v1': JSON.stringify({ bad: 5, k: record(['A']) }) })
    expect(readScan('k', store)?.hits).toEqual(['A'])
  })

  it('keeps only the newest records, since the settings are free-form', () => {
    const store = memory()
    for (let n = 0; n < 40; n++) writeScan(`k${n}`, record(['A'], ['A'], n), store)
    expect(readScan('k39', store)).not.toBeNull()
    expect(readScan('k16', store)).not.toBeNull()
    expect(readScan('k15', store)).toBeNull()
    expect(Object.keys(JSON.parse(store.data['ema-scan-v1'])).length).toBe(24)
  })
})

describe('diffScans', () => {
  it('has nothing to compare with on the first scan', () => {
    expect(diffScans(null, record(['A']))).toBeNull()
  })

  it('names who is new and who no longer touches', () => {
    const d = diffScans(record(['A', 'B'], ['A', 'B', 'C', 'D'], 500), record(['B', 'C'], ['A', 'B', 'C', 'D']))
    expect(d).toEqual({ fresh: ['C'], gone: ['A'], since: 500 })
  })

  it('reports no change when the same contracts touch', () => {
    const d = diffScans(record(['A', 'B']), record(['B', 'A']))
    expect(d?.fresh).toEqual([])
    expect(d?.gone).toEqual([])
  })

  it('does not call a contract gone when it was not looked at again', () => {
    // E touched last time and has since dropped out of the top by volume: nothing is known about it.
    const d = diffScans(record(['E', 'A'], ['A', 'E']), record(['A'], ['A', 'B']))
    expect(d?.gone).toEqual([])
  })
})
