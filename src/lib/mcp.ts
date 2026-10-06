import type { handleMcp as Declared } from '../../api/_mcp'
import { CONNECTOR_INSTRUCTIONS } from './claudePrompt'
import { computePerformance } from './performance'
import {
  buildAccount,
  collectAccount,
  collectClosed,
  collectMarket,
  fundingText,
  renderBots,
  renderHoldings,
  renderMethod,
  renderPerformance,
  renderPositions,
  renderSummary,
  patient,
  signalsText,
  type Get,
} from './snapshot'

/**
 * The claude.ai connector: a Model Context Protocol server over Streamable
 * HTTP, stateless, answering every POST with plain JSON (no SSE, no session).
 * Pro accounts can add it under Customize → Connectors → Add custom connector.
 *
 * Web-standard on purpose — `Request` in, `Response` out, the OKX call injected
 * as `get` — so it runs in the Vite dev server from source and on Vercel from
 * the bundle `npm run build` writes to `api/_mcp.js` (see `api/mcp.ts`).
 *
 * Every tool is read-only and goes through the same signed, allowlisted proxy
 * call as the app, and every text it returns is rendered by `snapshot.ts`, the
 * same code behind the "Copiar para Claude" button. Nothing here computes a
 * figure of its own.
 */

const SERVER = { name: 'cripto-monitor', title: 'Cripto Monitor', version: '1.0.0' }

/**
 * Versions this server's subset (tools, prompts, JSON replies) is valid for.
 * The client's is echoed when listed; otherwise the newest is offered and the
 * client decides, as the spec's negotiation asks.
 */
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

type Args = Record<string, unknown>

interface Tool {
  name: string
  title: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  run: (args: Args, get: Get) => Promise<string>
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

const PERIODS: Record<string, { days: number; label: string }> = {
  '7d': { days: 7, label: 'de los últimos 7 días' },
  '30d': { days: 30, label: 'de los últimos 30 días' },
  '90d': { days: 90, label: 'de los últimos 90 días' },
  todo: { days: 0, label: 'de todo el historial' },
}

/** An integer argument held to its range, so a model's "200" cannot fan out to 200 contracts. */
function intArg(args: Args, key: string, fallback: number, min: number, max: number): number {
  const raw = Number(args[key] ?? fallback)
  return Number.isFinite(raw) ? Math.min(max, Math.max(min, Math.round(raw))) : fallback
}

const stamp = () =>
  `_Leído de OKX el ${new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date())} UTC. Importes y precios en dólares (la cuenta liquida en USDC)._`

const TOOLS: Tool[] = [
  {
    name: 'estado_cuenta',
    title: 'Estado de la cuenta',
    description:
      'Estado actual de la cuenta de OKX: patrimonio, margen libre, avisos que requieren atención (posiciones sin stop, margen, bots al límite), posiciones abiertas con stop, objetivo y distancia a la liquidación, y bots en marcha. Empieza por aquí.',
    inputSchema: { type: 'object', properties: {} },
    async run(_args, get) {
      const s = buildAccount(await collectAccount(get))
      return [stamp(), renderSummary(s), renderPositions(s), renderBots(s)].join('\n\n')
    },
  },
  {
    name: 'rendimiento',
    title: 'Rendimiento',
    description:
      'Operaciones cerradas en derivados en un periodo: resultado neto de costes, acierto, factor de beneficio, esperanza por operación, rachas, desglose por activo y lado, y las últimas operaciones.',
    inputSchema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', enum: Object.keys(PERIODS), default: '30d', description: 'Ventana por fecha de cierre.' },
      },
    },
    async run(args, get) {
      const period = PERIODS[String(args.periodo ?? '30d')]
      if (!period) throw new Error(`Periodo no válido. Usa uno de: ${Object.keys(PERIODS).join(', ')}.`)
      const { closed, truncated } = await collectClosed(get)
      return [stamp(), renderPerformance(computePerformance(closed, period.days), period.label, truncated)].join('\n\n')
    },
  },
  {
    name: 'cartera',
    title: 'Cartera',
    description: 'Saldos de la cuenta de trading y de fondos, valorados en dólares, con su peso y su variación en 24 h.',
    inputSchema: { type: 'object', properties: {} },
    async run(_args, get) {
      return [stamp(), renderHoldings(buildAccount(await collectAccount(get)))].join('\n\n')
    },
  },
  {
    name: 'senales',
    title: 'Señales en vivo',
    description:
      'Señales vivas de las estrategias medidas en los X-Perp de cripto más negociados: la reversión diaria (con la recompensa/riesgo que queda), la ruptura de 20 velas a favor de la EMA 200 en 4 h (señal nueva, rompiendo, cerca) y el cruce de la EMA 200 en 4 h (señal nueva, cruzando, cerca). Tarda unos segundos.',
    inputSchema: {
      type: 'object',
      properties: {
        reversion_top: { type: 'integer', minimum: 10, maximum: 80, default: 40, description: 'Cuántos contratos revisar para la reversión diaria.' },
        ema_top: { type: 'integer', minimum: 5, maximum: 20, default: 10, description: 'Cuántos contratos revisar para las dos estrategias de 4 h (ruptura a favor de la EMA 200 y cruce de la EMA 200).' },
      },
    },
    async run(args, get) {
      return signalsText(get, await collectMarket(get), {
        reversal: intArg(args, 'reversion_top', 40, 10, 80),
        ema: intArg(args, 'ema_top', 10, 5, 20),
      })
    },
  },
  {
    name: 'financiacion',
    title: 'Financiación (carry)',
    description:
      'Para cada moneda que tengo: lo que ha pagado la financiación de su perpetuo en los últimos 7 días y ahora, cuántos contratos la cubrirían y qué dice la regla medida de carry (cubrir, esperar, deshacer).',
    inputSchema: { type: 'object', properties: {} },
    async run(_args, get) {
      const [raw, market] = await Promise.all([collectAccount(get), collectMarket(get)])
      return fundingText(get, buildAccount(raw), market)
    },
  },
  {
    name: 'estrategias',
    title: 'Estrategias medidas',
    description:
      'Las únicas estrategias que la app ofrece, con su esperanza en R, las dos mitades del histórico, el acierto y la confianza, y lo que se midió y no funciona. Léelo antes de hablar de entradas.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      return renderMethod()
    },
  },
]

const PROMPTS = [
  {
    name: 'revision',
    title: 'Revisión de la cuenta',
    description: 'Lo urgente, cómo voy y qué dicen hoy las estrategias medidas.',
    text: [
      'Haz la revisión de mi cuenta.',
      '1. Llama a estado_cuenta y empieza por lo que requiere atención.',
      '2. Llama a rendimiento con 30d y con todo, y dime si el último mes va mejor o peor que el resto.',
      '3. Llama a senales y dime si alguna estrategia medida da entrada hoy; si ninguna, dilo así.',
      'Breve y en este orden.',
    ].join('\n'),
  },
]

// ── JSON-RPC ──────────────────────────────────────────────────────────────────

interface RpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

type RpcReply = { jsonrpc: '2.0'; id: string | number | null } & ({ result: unknown } | { error: { code: number; message: string } })

const ok = (id: RpcRequest['id'], result: unknown): RpcReply => ({ jsonrpc: '2.0', id: id ?? null, result })
const fail = (id: RpcRequest['id'], code: number, message: string): RpcReply => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

async function dispatch(msg: RpcRequest, get: Get): Promise<RpcReply | null> {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    // A response or a malformed message: nothing to answer unless it carried an id.
    return msg && typeof msg === 'object' && 'id' in msg && !('result' in msg || 'error' in msg)
      ? fail(msg.id, -32600, 'Invalid Request')
      : null
  }
  // Notifications (no id) are acknowledged by the HTTP status, never answered.
  const isNotification = !('id' in msg)
  const { id, method, params = {} } = msg

  switch (method) {
    case 'initialize': {
      const asked = String(params.protocolVersion ?? '')
      return ok(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: SERVER,
        instructions: CONNECTOR_INSTRUCTIONS,
      })
    }
    case 'ping':
      return isNotification ? null : ok(id, {})
    case 'tools/list':
      return ok(id, { tools: TOOLS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema, annotations: { title, ...READ_ONLY } })) })
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name)
      if (!tool) return fail(id, -32602, `Herramienta desconocida: ${String(params.name)}`)
      try {
        const text = await tool.run((params.arguments as Args) ?? {}, get)
        return ok(id, { content: [{ type: 'text', text }] })
      } catch (err) {
        // A tool failure is a result the model can read and act on, not a protocol error.
        const message = err instanceof Error ? err.message : String(err)
        return ok(id, { content: [{ type: 'text', text: `No se pudo leer de OKX: ${message}` }], isError: true })
      }
    }
    case 'prompts/list':
      return ok(id, { prompts: PROMPTS.map(({ name, title, description }) => ({ name, title, description })) })
    case 'prompts/get': {
      const prompt = PROMPTS.find((p) => p.name === params.name)
      if (!prompt) return fail(id, -32602, `Prompt desconocido: ${String(params.name)}`)
      return ok(id, { description: prompt.description, messages: [{ role: 'user', content: { type: 'text', text: prompt.text } }] })
    }
    default:
      return isNotification ? null : fail(id, -32601, `Método no soportado: ${method}`)
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

/**
 * The whole endpoint. Authentication happens before this, in `api/mcp.ts`.
 * Typed by `api/_mcp.d.ts`, which is what the function sees of this bundle.
 */
export const handleMcp: typeof Declared = async (request, get) => {
  // No server-initiated stream is offered, which the spec answers with 405.
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { allow: 'POST' } })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(fail(null, -32700, 'Parse error'), 400)
  }
  const batch = Array.isArray(body)
  const messages: unknown[] = Array.isArray(body) ? body : [body]
  const okx = patient(get)
  const replies = (await Promise.all(messages.map((m) => dispatch(m as RpcRequest, okx)))).filter(
    (r): r is RpcReply => r !== null,
  )
  if (replies.length === 0) return new Response(null, { status: 202 })
  return json(batch ? replies : replies[0])
}
