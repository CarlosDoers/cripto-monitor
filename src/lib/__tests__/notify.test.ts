import { describe, expect, it, vi } from 'vitest'
import type { LedgerEntry } from '../ledger'
import { entryUrl, formatAlert as format, notifiersFromEnv, sendTestAlerts } from '../notify'

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

describe('the message for an equity, an ETF or a commodity', () => {
  const trad = (patch: Partial<LedgerEntry> = {}): LedgerEntry =>
    entry({
      id: 'trad/trend@1D:SPY:1',
      track: 'trad/trend@1D',
      strategy: 'donchian',
      preset: 'trend',
      bar: '1D',
      instId: 'SPY',
      symbol: 'SPY',
      entry: 771.79,
      stop: 740.5,
      kind: 'index',
      okxId: 'SPY-USD_UM_XPERP-310613',
      volume: 1.2,
      btcAbove: null,
      ...patch,
    })

  it('says which OKX contract to look at, prices it to the cent and quotes the evidence of its kind', () => {
    const m = formatAlert([trad()], 'https://app.test/')
    expect(m.title).toBe('Señal nueva · SPY · Long · 1 d')
    expect(m.body).toContain('Tendencia diaria · bolsa, ETF y oro: entrada 771,79 (cierre del subyacente) · stop 740,50 (4,1 % de riesgo')
    expect(m.body).toContain('contrato en OKX: SPY-USD_UM_XPERP-310613 · ETF de índice')
    expect(m.body).toContain('Medido en')
    expect(m.body).toContain('frente a')
    // The crypto tags were not measured on equities and are not printed, nor is the volume.
    expect(m.body).not.toContain('BTC sobre')
    expect(m.body).not.toContain('Volumen')
    expect(m.body).toContain('no una recomendación')
    expect(m.url).toBe('https://app.test/#/screener')
  })

  it('names a stock as having no evidence of its own, and a commodity as a thin sample', () => {
    const stock = formatAlert([trad({ instId: 'AAPL', symbol: 'AAPL', kind: 'stock', okxId: 'AAPL-USD_UM_XPERP-310613' })])
    expect(stock.title).toBe('Señal nueva · AAPL · Long · 1 d')
    expect(stock.body).toContain('Sin evidencia propia')
    expect(stock.body).toContain('supervivientes')
    const gold = formatAlert([trad({ instId: 'GLD', symbol: 'XAU', kind: 'commodity', okxId: 'XAU-USD_UM_XPERP-310502' })], undefined, ['   financiación ahora: +20,1 % anual, la paga quien está largo'])
    expect(gold.title).toBe('Señal nueva · XAU (oro) · Long · 1 d')
    expect(gold.body).toContain('Cuatro series')
    expect(gold.body).toContain('financiación ahora: +20,1 % anual, la paga quien está largo')
    expect(gold.url).toBeUndefined()
  })

  it('points a stock at the Screener, where its card is, not at a strategy chart it does not have', () => {
    expect(entryUrl(trad(), 'https://app.test/')).toBe('https://app.test/#/screener')
    expect(entryUrl(entry(), 'https://app.test')).toContain('#/estrategias?inst=ZEC')
  })
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

describe('the test message', () => {
  const ok = () => vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch

  it('says it is a test and that real signals will look like this, with a link to the section', async () => {
    const fetchImpl = ok()
    const res = await sendTestAlerts({ NTFY_TOPIC: 'mi-tema' }, 'https://app.test/', fetchImpl)
    expect(res).toEqual({ channels: [{ name: 'ntfy', ok: true }] })
    const calls = (fetchImpl as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls
    const body = JSON.parse(calls[0][1].body)
    expect(body).toMatchObject({ topic: 'mi-tema', title: 'Aviso de prueba · Cripto Monitor', click: 'https://app.test/#/seguimiento' })
    expect(body.message).toContain('Esto no es una señal')
    // A second message shows how an equities signal will read, labelled as an example with invented figures.
    expect(calls).toHaveLength(2)
    const example = JSON.parse(calls[1][1].body)
    expect(example.title).toBe('Ejemplo · Señal nueva · XAU (oro) · Long · 1 d')
    expect(example.message).toContain('Las cifras de este mensaje son inventadas')
    expect(example.message).toContain('contrato en OKX: XAU-USD_UM_XPERP-310502')
    expect(example.message).toContain('financiación ahora')
    // And the line about the book, so the first real one is not the first time it is read.
    expect(example.message).toContain('liquidez ahora: entrar con 5000 $ cuesta')
    expect(example.click).toBe('https://app.test/#/screener')
  })

  it('tries every channel and reports each, without throwing when one fails', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes('telegram') ? new Response('no', { status: 403, statusText: 'Forbidden' }) : new Response('{}', { status: 200 }),
    ) as unknown as typeof fetch
    const res = await sendTestAlerts({ NTFY_TOPIC: 't', TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_CHAT_ID: '42' }, undefined, fetchImpl)
    expect(res.channels).toEqual([
      { name: 'ntfy', ok: true },
      { name: 'telegram', ok: false, error: '403 Forbidden' },
    ])
  })

  it('never puts a secret in the error it hands back, even when the network fails', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const res = await sendTestAlerts({ TELEGRAM_BOT_TOKEN: '123:SECRETO', TELEGRAM_CHAT_ID: '42' }, undefined, down)
    expect(res.channels[0].ok).toBe(false)
    expect(JSON.stringify(res)).not.toContain('SECRETO')
  })

  it('has nothing to report where no channel is configured', async () => {
    expect(await sendTestAlerts({}, 'https://app.test')).toEqual({ channels: [] })
  })
})
