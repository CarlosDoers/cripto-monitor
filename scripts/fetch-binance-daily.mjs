// Daily candles of every USDT spot pair Binance ever listed — including the ones it delisted — from the
// public data portal (data.binance.vision). The board in ./.candles-board-1D holds only the coins that
// are liquid TODAY, which flatters any rule that buys what went up; this is the universe those rules
// would actually have faced.
//
//   node scripts/fetch-binance-daily.mjs            every symbol, complete months only → ./.research/binance-1d
//   LIMIT=40 node scripts/fetch-binance-daily.mjs   the first 40 symbols (a trial)
//   REFRESH=1 …                                     fetch again what is already on disk
//
// No key, no OKX proxy: the files are public. Each symbol is [openTime, open, high, low, close, volume,
// quoteVolume] rows, 00:00 UTC days. Since 2025 the portal's timestamps are microseconds; they are
// normalised to milliseconds here.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

const HOST = 'https://data.binance.vision'
const BUCKET = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision'
const OUT = './.research/binance-1d'
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 24)
mkdirSync(OUT, { recursive: true })

async function get(url, binary = false, tries = 4) {
  for (let k = 0; k < tries; k++) {
    try {
      const res = await fetch(url)
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return binary ? Buffer.from(await res.arrayBuffer()) : await res.text()
    } catch (e) {
      if (k === tries - 1) throw new Error(`${url}: ${e.message}`)
      await new Promise((r) => setTimeout(r, 400 * (k + 1)))
    }
  }
}

/** Every `<tag>` value of an S3 listing page. */
const tags = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map((m) => m[1])

async function list(prefix, delimiter) {
  const out = []
  let marker = ''
  for (;;) {
    const url = `${BUCKET}?prefix=${encodeURIComponent(prefix)}${delimiter ? `&delimiter=${encodeURIComponent(delimiter)}` : ''}&max-keys=1000${marker ? `&marker=${encodeURIComponent(marker)}` : ''}`
    const xml = await get(url)
    if (!xml) break
    const page = delimiter ? tags(xml, 'Prefix').filter((x) => x !== prefix) : tags(xml, 'Key')
    out.push(...page)
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break
    marker = delimiter ? tags(xml, 'NextMarker')[0] : page[page.length - 1]
    if (!marker) break
  }
  return out
}

/** The one entry of a single-file zip, deflated. */
function unzip(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip')
  const method = buf.readUInt16LE(8)
  const size = buf.readUInt32LE(18)
  const name = buf.readUInt16LE(26)
  const extra = buf.readUInt16LE(28)
  const data = buf.subarray(30 + name + extra, 30 + name + extra + size)
  return (method === 8 ? inflateRawSync(data) : data).toString('utf8')
}

const STABLE = /^(USDC|BUSD|TUSD|USDP|FDUSD|DAI|EUR|GBP|AUD|TRY|BRL|USDS|PAX|USDSB|UST|SUSD|USD1|AEUR|XUSD|EURI|PYUSD|BFUSD|USDE|RLUSD|VAI|IDRT|UAH|NGN|ARS|ZAR|RUB|BIDR|BVND|PLN|RON|CZK|JPY|MXN|COP)$/
const LEVERAGED = /(UP|DOWN|BULL|BEAR)$/

const prefixes = await list('data/spot/monthly/klines/', '/')
let symbols = prefixes
  .map((x) => x.split('/').slice(-2)[0])
  .filter((s) => s.endsWith('USDT'))
  .map((s) => s.slice(0, -4))
  .filter((b) => b.length > 0 && !STABLE.test(b) && !(LEVERAGED.test(b) && b.length > 4))
  .sort()
if (process.env.LIMIT) symbols = symbols.slice(0, Number(process.env.LIMIT))
console.log(`${symbols.length} símbolos USDT (sin estables ni apalancados)`)

let done = 0
let rows = 0
async function one(base) {
  const path = `${OUT}/${base}.json`
  if (existsSync(path) && !process.env.REFRESH) return
  const symbol = `${base}USDT`
  const keys = (await list(`data/spot/monthly/klines/${symbol}/1d/`)).filter((k) => k.endsWith('.zip'))
  const all = []
  for (const key of keys) {
    const zip = await get(`${HOST}/${key}`, true)
    if (!zip) continue
    for (const line of unzip(zip).split('\n')) {
      const c = line.split(',')
      if (c.length < 8 || !/^\d/.test(c[0])) continue
      let t = Number(c[0])
      if (t > 1e14) t = Math.floor(t / 1000)
      all.push([t, +c[1], +c[2], +c[3], +c[4], +c[5], +c[7]])
    }
  }
  all.sort((a, b) => a[0] - b[0])
  writeFileSync(path, JSON.stringify(all))
  rows += all.length
}

const queue = [...symbols]
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const base = queue.shift()
      try {
        await one(base)
      } catch (e) {
        console.log(`  ✗ ${base}: ${e.message}`)
      }
      if (++done % 25 === 0) console.log(`  ${done}/${symbols.length}`)
    }
  }),
)
console.log(`listo: ${done} símbolos, ${rows} velas nuevas → ${OUT}`)
