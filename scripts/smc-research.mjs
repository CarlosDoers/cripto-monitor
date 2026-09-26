// The evidence behind Smart Money Concepts as a signal, beyond what `npm run try`
// checks: the distribution, the best trades removed, each instrument, each
// year, each side, cost, and the neighbourhood of the swing lengths.
//
//   npm run smc
//
// Needs ./.candles populated by `npm run candles`.
import { readFileSync, readdirSync } from 'node:fs'
import { structureTrades } from '../src/lib/indicators/smcTrade.ts'
import { SMC_SETTINGS } from '../src/lib/indicators/smc.ts'

const DIR = './.candles'
const series = {}
for (const f of readdirSync(DIR)) {
  const [inst, bar] = f.replace('.json', '').split('__')
  series[bar] ??= {}
  series[bar][inst] = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))
}

let seed = 7
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
const f = (x, d = 2) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '  —  ')
function boot(a, k = 2000) {
  seed = 7
  const m = []
  for (let j = 0; j < k; j++) {
    let s = 0
    for (let i = 0; i < a.length; i++) s += a[Math.floor(rnd() * a.length)]
    m.push(s / a.length)
  }
  m.sort((x, y) => x - y)
  return `[${f(m[Math.floor(k * 0.025)])}, ${f(m[Math.floor(k * 0.975)])}]`
}

function trades(bar, scale, settings = SMC_SETTINGS, slice = 'all') {
  const out = []
  for (const [inst, full] of Object.entries(series[bar] ?? {})) {
    const h = Math.floor(full.length / 2)
    const cs = slice === 'first' ? full.slice(0, h) : slice === 'second' ? full.slice(h) : full
    if (cs.length < 250) continue
    for (const s of structureTrades(cs, scale, false, settings).signals) {
      if (s.outcome !== 'open' && Number.isFinite(s.resultR)) out.push({ ...s, inst, net: s.resultR - s.feeR })
    }
  }
  return out
}

const CELLS = [
  ['swing', '1H'],
  ['internal', '4H'],
  ['internal', '1D'],
]

for (const [scale, bar] of CELLS) {
  const all = trades(bar, scale)
  const nets = all.map((s) => s.net)
  const sorted = [...all].sort((a, b) => b.net - a.net)
  const total = nets.reduce((a, b) => a + b, 0)
  const top5 = sorted.slice(0, 5).reduce((a, s) => a + s.net, 0)
  console.log(`\n### ${scale === 'swing' ? 'principal (50)' : 'interna (5)'} · ${bar} · n=${all.length}`)
  console.log(`  media ${f(mean(nets))} R · IC95 ${boot(nets)} · acierto ${((all.filter((s) => s.net > 0).length / all.length) * 100).toFixed(1)} %`)
  console.log(`  las 5 mejores aportan ${((top5 / total) * 100).toFixed(0)} % · sin la mejor ${f(mean(sorted.slice(1).map((s) => s.net)))} · sin 5 ${f(mean(sorted.slice(5).map((s) => s.net)))} · sin 10 ${f(mean(sorted.slice(10).map((s) => s.net)))}`)
  console.log(`  mejores: ${sorted.slice(0, 5).map((s) => `${s.inst.replace(/_USD.*|_USDT/, '')} ${new Date(s.time).toISOString().slice(0, 10)} ${f(s.net, 1)}`).join(' | ')}`)
  const at = (k) => mean(all.map((s) => s.resultR - s.feeR * k))
  console.log(`  comisión 0,066 % ${f(at(0.66))} · 0,1 % ${f(at(1))} · 0,2 % ${f(at(2))} · coste medio ${f(mean(all.map((s) => s.feeR)))} R`)
  const byInst = {}
  for (const s of all) (byInst[s.inst] ??= []).push(s.net)
  console.log('  instrumentos: ' + Object.entries(byInst).map(([k, v]) => `${k.replace(/_UM_XPERP_\d+/, '·X').replace('_USDT', '')} ${f(mean(v))}(${v.length})`).join('  '))
  const spot = all.filter((s) => /_USDT$/.test(s.inst)).map((s) => s.net)
  console.log(`  solo BTC/ETH/SOL spot: ${f(mean(spot))} (n=${spot.length}) IC95 ${boot(spot)}`)
  const byYear = {}
  for (const s of all) (byYear[new Date(s.time).getUTCFullYear()] ??= []).push(s.net)
  console.log('  años: ' + Object.entries(byYear).map(([y, v]) => `${y} ${f(mean(v))}(${v.length})`).join('  '))
  const L = all.filter((s) => s.side === 'long').map((s) => s.net)
  const S = all.filter((s) => s.side === 'short').map((s) => s.net)
  console.log(`  largos ${f(mean(L))}(${L.length}) · cortos ${f(mean(S))}(${S.length})`)

  // Neighbourhood: the length this scale uses, varied around the default.
  const key = scale === 'swing' ? 'swingLength' : 'internalLength'
  const lengths = scale === 'swing' ? [30, 40, 50, 60, 70] : [3, 4, 5, 6, 7, 8]
  const row = lengths.map((len) => {
    const s = { ...SMC_SETTINGS, [key]: len }
    const a = mean(trades(bar, scale, s).map((x) => x.net))
    const i = mean(trades(bar, scale, s, 'first').map((x) => x.net))
    const o = mean(trades(bar, scale, s, 'second').map((x) => x.net))
    const both = Math.min(i, o) >= 0.1 ? '' : '*'
    return `${len}: ${f(a)}${both}`
  })
  console.log(`  vecindario (${key}): ${row.join('  ')}   (* = alguna mitad bajo 0,1 R)`)
}
