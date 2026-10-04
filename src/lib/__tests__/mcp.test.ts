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

  it('lists six read-only tools', async () => {
    const body = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()
    expect(body.result.tools).toHaveLength(6)
    for (const t of body.result.tools) expect(t.annotations.readOnlyHint).toBe(true)
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
