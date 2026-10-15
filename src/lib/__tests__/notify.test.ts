import { describe, expect, it, vi } from 'vitest'
import type { LedgerEntry } from '../ledger'
import { entryUrl, formatAlert as format, notifiersFromEnv } from '../notify'

/** Intl puts a no-break space before "%": a test reads the text as a person does. */
const formatAlert = (...args: Parameters<typeof format>) => {
  const m = format(...args)
  return { ...m, body: m.body.replace(/\u00a0/g, ' ') }
}

const entry = (patch: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: 'donchian/trend@4H:ZEC-USD_UM_XPERP-1:1000',
  track: 'donchian/trend@4H',
  strategy: 'donchian',
  preset: 'trend',
  bar: '4H',
  instId: 'ZEC-USD_UM_XPERP-1',
  symbol: 'ZEC',
  side: 'long',
  at: 1000,
  entry: 100,
  stop: 96,
  status: 'open',
  feeR: 0.02,
  seen: 0,
  volume: 2.3,
  btcAbove: true,
  weekend: false,
  ...patch,
})

describe('the message', () => {
  it('says what fired, where its stop is, what was measured and what is around it', () => {
    const m = formatAlert([entry()], 'https://app.test/')
    expect(m.title).toBe('Señal nueva · ZEC · Long · 4 h')
    expect(m.body).toContain('Ruptura · Canal 20 + EMA 200 · 4 h: entrada 100,00 · stop 96,00 (4,0 % de riesgo)')
    expect(m.body).toContain('medido +0,36 R por operación; longs +0,61 R')
    expect(m.body).toContain('BTC sobre su EMA 200 · Volumen 2,3×')
    expect(m.body).toContain('no una recomendación')
    expect(m.url).toBe('https://app.test/#/estrategias?inst=ZEC-USD_UM_XPERP-1&s=donchian&p=trend&tf=4H')
  })

  it('gives strategies that fired on the same candle one message with a line each', () => {
    const m = formatAlert([entry({ track: 'donchian/fast@4H', preset: 'fast', stop: 94 }), entry(), entry({ track: 'ema200/base@4H', strategy: 'ema200', preset: 'base' })])
    expect(m.body.match(/entrada/g)).toHaveLength(3)
    // It leads with the preset the app leads with, whatever the order they arrived in.
    expect(m.url).toBeUndefined()
    expect(formatAlert([entry({ track: 'donchian/fast@4H', preset: 'fast' }), entry()], 'https://a.test').url).toContain('p=trend')
  })

  it('shows the target and the shorts figure for a fixed-target strategy', () => {
    const m = formatAlert([entry({ track: 'reversal/tuned@1D', strategy: 'reversal', preset: 'tuned', bar: '1D', side: 'short', target: 90, stop: 104 })])
    expect(m.title).toBe('Señal nueva · ZEC · Short · 1 d')
    expect(m.body).toContain('objetivo 90,00 (-10,0 %)')
    expect(m.body).toContain('shorts +0,12 R')
  })

  it('builds the link with the contract, strategy, preset and bar', () => {
    expect(entryUrl(entry({ side: 'short' }), 'https://x.test///')).toBe(
      'https://x.test/#/estrategias?inst=ZEC-USD_UM_XPERP-1&s=donchian&p=trend&tf=4H',
    )
  })
})

describe('the channels', () => {
  const message = { title: 'Señal nueva · ZEC', body: 'cuerpo\nlinea', url: 'https://app.test/#/x' }

  it('publishes to ntfy as JSON, so accents survive', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    const [n] = notifiersFromEnv({ NTFY_TOPIC: ' mi-tema ', NTFY_TOKEN: 'tk_1' }, fetchImpl as unknown as typeof fetch)
    expect(n.name).toBe('ntfy')
    await n.send(message)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }]
    expect(url).toBe('https://ntfy.sh/')
    expect(init.headers.authorization).toBe('Bearer tk_1')
    expect(JSON.parse(init.body)).toMatchObject({ topic: 'mi-tema', title: 'Señal nueva · ZEC', message: 'cuerpo\nlinea', click: 'https://app.test/#/x' })
  })

  it('takes a self-hosted ntfy address, and ignores one that is not a URL', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    const own = notifiersFromEnv({ NTFY_TOPIC: 't', NTFY_URL: 'https://ntfy.mi-casa.test' }, fetchImpl as unknown as typeof fetch)
    await own[0].send(message)
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://ntfy.mi-casa.test/')
    const bad = notifiersFromEnv({ NTFY_TOPIC: 't', NTFY_URL: 'javascript:alert(1)' }, fetchImpl as unknown as typeof fetch)
    await bad[0].send(message)
    expect((fetchImpl.mock.calls[1] as unknown as [string])[0]).toBe('https://ntfy.sh/')
  })

  it('sends a plain text message through Telegram', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    const [n] = notifiersFromEnv({ TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_CHAT_ID: '42' }, fetchImpl as unknown as typeof fetch)
    expect(n.name).toBe('telegram')
    await n.send(message)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string }]
    expect(url).toBe('https://api.telegram.org/bot123:abc/sendMessage')
    expect(JSON.parse(init.body)).toMatchObject({ chat_id: '42', disable_web_page_preview: true })
    expect(JSON.parse(init.body).text).toContain('Señal nueva · ZEC')
  })

  it('needs both halves of the Telegram pair, and reports a refusal instead of swallowing it', async () => {
    expect(notifiersFromEnv({ TELEGRAM_BOT_TOKEN: '123:abc' })).toEqual([])
    expect(notifiersFromEnv({})).toEqual([])
    const refused = vi.fn(async () => new Response('no', { status: 403, statusText: 'Forbidden' }))
    const [n] = notifiersFromEnv({ NTFY_TOPIC: 't' }, refused as unknown as typeof fetch)
    await expect(n.send(message)).rejects.toThrow('403')
  })
})
