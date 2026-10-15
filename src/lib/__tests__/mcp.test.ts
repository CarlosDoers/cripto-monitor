import { describe, expect, it } from 'vitest'
import { handleMcp } from '../mcp'
import type { Get } from '../snapshot'

const noOkx: Get = async () => {
  throw new Error('no network in tests')
}
const post = (body: unknown) =>
  handleMcp(new Request('http://x/api/mcp', { method: 'POST', body: JSON.stringify(body) }), noOkx)

describe('the claude.ai connector', () => {
  it('negotiates the protocol version and hands over its instructions', async () => {
    const res = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
    const body = await res.json()
    expect(body.result.protocolVersion).toBe('2025-06-18')
    expect(body.result.instructions).toContain('No propongas entradas')
  })

  it('offers the newest version it knows when the client asks for an unknown one', async () => {
    const body = await (await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).json()
    expect(body.result.protocolVersion).toBe('2025-11-25')
  })

  it('lists seven read-only tools', async () => {
    const body = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()
    expect(body.result.tools).toHaveLength(7)
    expect(body.result.tools.map((t: { name: string }) => t.name)).toContain('seguimiento')
    for (const t of body.result.tools) expect(t.annotations.readOnlyHint).toBe(true)
  })

  it('offers the short reading of the breakout as an option of senales, off by default', async () => {
    const body = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()
    const senales = body.result.tools.find((t: { name: string }) => t.name === 'senales')
    expect(senales.inputSchema.properties.corto_plazo).toMatchObject({ type: 'boolean', default: false })
  })

  it('reads the tracking ledger through what the server hands it, and says so when there is none', async () => {
    const call = (extras?: Parameters<typeof handleMcp>[2]) =>
      handleMcp(
        new Request('http://x/api/mcp', {
          method: 'POST',
          body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'seguimiento' } }),
        }),
        noOkx,
        extras,
      ).then((r) => r.json())
    const none = await call()
    expect(none.result.content[0].text).toContain('todavía no tiene datos')
    const ledger = {
      version: 1,
      startedAt: Date.UTC(2026, 9, 1),
      lastRun: Date.UTC(2026, 9, 15),
      runs: 3,
      since: {},
      universe: {},
      processed: {},
      entries: [],
    }
    const some = await call({ ledger: async () => ledger })
    expect(some.result.isError).toBeUndefined()
    expect(some.result.content[0].text).toContain('# Seguimiento en vivo')
    expect(some.result.content[0].text).toContain('las operaciones cerradas de un registro joven son casi todas pérdidas')
  })

  it('acknowledges a notification with 202 and no body', async () => {
    const res = await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(res.status).toBe(202)
  })

  it('reports an OKX failure as a tool result the model can read', async () => {
    const body = await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'cartera', arguments: {} } })).json()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('No se pudo leer de OKX')
  })

  it('answers the measured strategies without touching OKX', async () => {
    const body = await (await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'estrategias' } })).json()
    expect(body.result.isError).toBeUndefined()
    expect(body.result.content[0].text).toContain('Cómo leer esto')
  })

  it('rejects unknown tools and methods, and GET', async () => {
    expect((await (await post({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'comprar' } })).json()).error.code).toBe(-32602)
    expect((await (await post({ jsonrpc: '2.0', id: 6, method: 'resources/list' })).json()).error.code).toBe(-32601)
    expect((await handleMcp(new Request('http://x/api/mcp'), noOkx)).status).toBe(405)
  })
})
