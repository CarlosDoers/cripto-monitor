import { contextLine } from './entryContext'
import { pct, price, ratio, share } from './format'
import { entryTags, REFERENCE, trackLabel, type LedgerEntry } from './ledger'

/**
 * The notification a new signal produces, and the two channels it can go to.
 *
 * Outbound only and read-only toward OKX: the server tells you a signal of a
 * measured strategy has appeared, and nothing can place an order from here or
 * from a phone. A message carries the signal and what was measured about it,
 * never the account — a public ntfy topic is readable by anyone who knows its
 * name, which is why the name should be long and random.
 */

export interface AlertMessage {
  title: string
  body: string
  /** Where the app shows this signal. */
  url?: string
}

export interface Notifier {
  name: 'ntfy' | 'telegram'
  send(message: AlertMessage): Promise<void>
}

type Env = Record<string, string | undefined>
type Fetch = typeof fetch

const signedR = (x: number) => `${x >= 0 ? '+' : '−'}${ratio(Math.abs(x))}`
const barText = (bar: LedgerEntry['bar']) => (bar === '1D' ? '1 d' : bar === '4H' ? '4 h' : '1 h')

/** The link into Estrategias on this contract, bar and preset. */
export function entryUrl(e: LedgerEntry, appUrl: string): string {
  const query = new URLSearchParams({ inst: e.instId, s: e.strategy, p: e.preset, tf: e.bar })
  return `${appUrl.replace(/\/+$/, '')}/#/estrategias?${query}`
}

/**
 * One message per entry candle and contract: three strategies breaking out on
 * the same close are one thing to look at, not three buzzes. `group` shares the
 * contract, the side, the bar and the candle; each strategy keeps its own line
 * because its stop, and what was measured for it, differ.
 */
export function formatAlert(group: LedgerEntry[], appUrl?: string): AlertMessage {
  const [first] = group
  const side = first.side === 'long' ? 'Long' : 'Short'
  const lines = group.flatMap((e) => {
    const ref = REFERENCE[e.track]
    const risk = Math.abs(e.entry - e.stop) / e.entry
    return [
      `${trackLabel(e.track)}: entrada ${price(e.entry)} · stop ${price(e.stop)} (${share(risk, 1)} de riesgo)${
        e.target !== undefined ? ` · objetivo ${price(e.target)} (${pct((e.target - e.entry) / e.entry, 1)})` : ''
      }`,
      ref
        ? `   medido ${signedR(ref.net)} R por operación; ${e.side === 'long' ? 'longs' : 'shorts'} ${signedR(e.side === 'long' ? ref.longs : ref.shorts)} R (${ref.sample})`
        : '',
    ]
  })
  // The candle is the same for all of them, so its context is too: say it once.
  const tags = contextLine(entryTags(first))
  const body = [...lines.filter(Boolean), tags, 'Contexto para vigilar, no una recomendación: la app no opera.']
    .filter(Boolean)
    .join('\n')
  // The preset the app leads with: the filtered breakout, then the cross, then the plain breakout.
  const lead = [...group].sort((a, b) => PRIORITY(a.track) - PRIORITY(b.track))[0]
  return {
    title: `Señal nueva · ${first.symbol} · ${side} · ${barText(first.bar)}`,
    body,
    url: appUrl ? entryUrl(lead, appUrl) : undefined,
  }
}

const PRIORITY = (track: string) => {
  const order = ['donchian/trend', 'ema200/base', 'donchian/fast', 'reversal/tuned']
  const i = order.findIndex((o) => track.startsWith(o))
  return i < 0 ? order.length : i
}

const timeout = () => AbortSignal.timeout(8_000)

async function post(fetchImpl: Fetch, url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: timeout(),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim())
}

const validUrl = (raw: string | undefined): string | null => {
  if (!raw) return null
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

/**
 * The channels the environment configures. ntfy takes the JSON form of
 * publishing, which carries accents intact where its header form would not;
 * Telegram takes a plain text message. With nothing configured the list is
 * empty and the server just records.
 */
export function notifiersFromEnv(env: Env, fetchImpl: Fetch = fetch): Notifier[] {
  const out: Notifier[] = []

  const topic = env.NTFY_TOPIC?.trim()
  if (topic) {
    const server = validUrl(env.NTFY_URL) ?? 'https://ntfy.sh/'
    out.push({
      name: 'ntfy',
      send: (m) =>
        post(
          fetchImpl,
          server,
          { topic, title: m.title, message: m.body, click: m.url, tags: ['chart_with_upwards_trend'], priority: 3 },
          env.NTFY_TOKEN ? { authorization: `Bearer ${env.NTFY_TOKEN}` } : {},
        ),
    })
  }

  const bot = env.TELEGRAM_BOT_TOKEN?.trim()
  const chat = env.TELEGRAM_CHAT_ID?.trim()
  if (bot && chat) {
    out.push({
      name: 'telegram',
      send: (m) =>
        post(fetchImpl, `https://api.telegram.org/bot${bot}/sendMessage`, {
          chat_id: chat,
          text: [m.title, '', m.body, m.url ?? ''].join('\n').trim(),
          disable_web_page_preview: true,
        }),
    })
  }
  return out
}

export interface TestResult {
  channels: { name: Notifier['name']; ok: boolean; error?: string }[]
}

/**
 * A message that is not a signal, through every configured channel: the way to
 * find out that the topic, the token and the phone are right without waiting
 * for the market. `ok` means the channel's server accepted it — ntfy answers
 * yes even when nobody is subscribed to the topic — so the view tells the
 * person to look at their phone, and what to check if nothing arrives. A
 * failure comes back as a result, never as an exception, and carries only the
 * status line: a Telegram address has the bot's token in it.
 */
export async function sendTestAlerts(env: Env, appUrl?: string, fetchImpl: Fetch = fetch): Promise<TestResult> {
  const message: AlertMessage = {
    title: 'Aviso de prueba · Cripto Monitor',
    body: [
      'Si lees esto, los avisos funcionan: el servidor ha podido mandarte un mensaje.',
      'Las señales reales llegarán así, con su stop, lo medido y el contexto. Esto no es una señal.',
    ].join('\n'),
    url: appUrl ? `${appUrl.replace(/\/+$/, '')}/#/seguimiento` : undefined,
  }
  const channels: TestResult['channels'] = []
  for (const n of notifiersFromEnv(env, fetchImpl)) {
    try {
      await n.send(message)
      channels.push({ name: n.name, ok: true })
    } catch (err) {
      channels.push({ name: n.name, ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 120) })
    }
  }
  return { channels }
}

/** Which channels are configured, by name only: a secret never travels to the browser. */
export const channelNames = (env: Env): string[] => notifiersFromEnv(env, fetch).map((n) => n.name)
