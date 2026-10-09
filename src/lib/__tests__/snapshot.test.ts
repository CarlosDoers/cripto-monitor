import { describe, expect, it } from 'vitest'
import { ema } from '../indicators/ta'
import { signalsText, type Get, type RawMarket } from '../snapshot'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 9, 12)

/** OKX serves candles newest first, as strings, with the last one still forming. */
function rows(closes: number[], bar: string): string[][] {
  const step = bar === '4H' ? DAY / 6 : DAY
  return closes
    .map((c, i) => {
      const t = NOW - (closes.length - 1 - i) * step
      const forming = i === closes.length - 1
      return [String(t), String(c - 1), String(c + 0.5), String(c - 0.5), String(c), '10', '10', '10', forming ? '0' : '1']
    })
    .reverse()
}

// A steady climb: the EMA 25 trails ~24 below the close, so nothing touches it
// until the live price comes down onto it.
const closes = (n: number) => Array.from({ length: n }, (_, i) => 100 + 2 * i)
const line = ema(closes(200), 25).at(-1)!

const market = (last: number): RawMarket =>
  ({
    instruments: [{ instId: 'AAA-USD_UM_XPERP-1', state: 'live', instCategory: '1' }],
    tickers: [{ instId: 'AAA-USD_UM_XPERP-1', last: String(last), volCcy24h: '50000000' }],
  }) as unknown as RawMarket

/** Answers every candle request from the same climb, except the ones `fail` names. */
const candles =
  (fail: string[] = []): Get =>
  async <T,>(_path: string, params?: Record<string, string | number | undefined>) => {
    const bar = String(params?.bar)
    if (fail.includes(bar)) throw new Error(`sin velas ${bar}`)
    return rows(closes(bar === '1D' ? 300 : bar === '1Dutc' ? 200 : 100), bar) as unknown as T[]
  }

const opts = { reversal: 10, ema: 5 }

describe('the live signals text: EMA 25 touches', () => {
  it('names who touched, with the context-not-signal warning first', async () => {
    const text = await signalsText(candles(), market(line - 3), { ...opts, touch: 20 })
    const section = text.slice(text.indexOf('## Toques a la EMA 25 diaria'))
    expect(section).toContain('últimas 3 velas, cierre UTC')
    expect(section).toContain('Contexto, no señal')
    // The live price is what brings today's forming candle onto the line: it says "hoy", and says it
    // in its own column, since a single touch's sentence does not repeat the day.
    expect(section).toContain('| AAA | hoy | vino desde arriba')
    expect(section).not.toContain('Ninguno de los')
  })

  it('says so when nobody touched, instead of printing an empty table', async () => {
    const text = await signalsText(candles(), market(closes(200).at(-1)!), { ...opts, touch: 20 })
    expect(text).toContain('Ninguno de los 1 contratos ha tocado la EMA en las últimas 3 velas.')
  })

  it('leaves the section out when asked for none, and for callers that never asked', async () => {
    expect(await signalsText(candles(), market(line - 3), { ...opts, touch: 0 })).not.toContain('Toques a la EMA')
    expect(await signalsText(candles(), market(line - 3), opts)).not.toContain('Toques a la EMA')
  })

  it('costs only that section when the daily UTC candles cannot be read', async () => {
    const text = await signalsText(candles(['1Dutc']), market(line - 3), { ...opts, touch: 20 })
    expect(text).toContain('No se pudo leer: sin velas 1Dutc')
    // The strategies' own sections are still there.
    expect(text).toContain('## Reversión diaria')
    expect(text).toContain('## EMA 200 en 4 h')
  })
})
