import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Badge, Card, DeltaValue, EmptyState, ErrorNotice, Help, ProgressBar, Skeleton, Stat, TableWrap } from '../components/ui'
import { SideBadge } from '../components/WatchCells'
import { runWatchNow, testNotify } from '../lib/api'
import { CONTEXT_EVIDENCE, HIGH_VOLUME } from '../lib/entryContext'
import { dateTime, plural, price, quote, ratio, timeAgo } from '../lib/format'
import { HELP } from '../lib/glossary'
import {
  contextSplits,
  currentR,
  entryTags,
  MIN_READ,
  offeredTracks,
  readLive,
  REFERENCE,
  signedRText as signedR,
  trackLabel,
  trackStats,
  tradesToTell,
  type LedgerEntry,
  type Reading,
  type SplitStat,
} from '../lib/ledger'
import { MIN_SAMPLE } from '../lib/performance'
import { useWatchLedger } from '../lib/queries'
import { routeHref } from '../lib/router'
import { isTradTrack, TRAD_KIND, TRAD_LIQUIDITY } from '../lib/tradMarkets'

const READING: Record<Reading, { label: string; variant: 'neutral' | 'warn' | 'live'; title: string }> = {
  'sin-muestra': {
    label: 'Muy pocas',
    variant: 'neutral',
    title: `Menos de ${MIN_READ} señales: no hay nada que leer todavía.`,
  },
  compatible: {
    label: 'Dentro del ruido',
    variant: 'neutral',
    title: 'Las señales valen lo que valían las del histórico a su edad, dentro de lo que el azar mueve una media de tantas: no desmiente lo medido ni lo confirma.',
  },
  'por-encima': {
    label: 'Por encima',
    variant: 'live',
    title: 'Las señales valen más que las del histórico a su edad, fuera de la banda de ruido.',
  },
  'por-debajo': {
    label: 'Por debajo',
    variant: 'warn',
    title: 'Las señales valen menos que las del histórico a su edad, fuera de la banda de ruido. Es lo que habría que vigilar.',
  },
}

const SHOWN = 40
const thousands = (n: number) => new Intl.NumberFormat('es-ES').format(n)

/** A mean with its count, and a dash where the sample is under what the app reads anything from. */
function Split({ s, strong }: { s: SplitStat; strong?: boolean }) {
  if (s.n < MIN_SAMPLE) {
    return (
      <span className="sub">
        — <span className="sub">· {s.n}</span>
      </span>
    )
  }
  return (
    <span>
      {strong ? <strong>{signedR(s.mean)} R</strong> : `${signedR(s.mean)} R`} <span className="sub">· {s.n}</span>
    </span>
  )
}

const weeksText = (weeks: number) => {
  if (!Number.isFinite(weeks)) return null
  if (weeks > 104) return 'más de dos años'
  if (weeks < 1) return 'menos de una semana'
  return plural(Math.round(weeks), 'semana', 'semanas')
}

/**
 * *Seguimiento*: what became of every signal the measured strategies gave since
 * the server began to write them down. The history can say what a search found
 * in it; this is the one place the app holds signals recorded before their
 * outcome existed. It is slow by nature — a trend follower's trade is worth
 * 3–4 R either way against a mean of 0.2 — and the page does the arithmetic of
 * how slow instead of passing a verdict on a handful of trades.
 */
export function Tracking() {
  const q = useWatchLedger()
  const client = useQueryClient()
  const [running, setRunning] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [all, setAll] = useState(false)

  const state = q.data
  const ledger = state?.ledger ?? null
  const entries = useMemo(() => (ledger?.entries ?? []).filter((e) => !e.lost), [ledger])

  const tracks = useMemo(() => {
    const offered = offeredTracks().map((t) => t.key)
    const extra = [...new Set(entries.map((e) => e.track))].filter((k) => !offered.includes(k))
    return [...offered, ...extra]
  }, [entries])

  // A message that is not a signal, through the configured channels. The server accepting it is all it can
  // know: ntfy says yes even when nobody is subscribed to the topic, so the note sends the person to the phone.
  const sendTest = async () => {
    setTesting(true)
    setNote(null)
    try {
      const { channels } = await testNotify()
      const failed = channels.filter((c) => !c.ok)
      setNote(
        channels.length === 0
          ? 'No hay ningún canal de avisos configurado en el servidor.'
          : failed.length === 0
            ? `Enviado por ${channels.map((c) => c.name).join(' y ')}: deberían sonar dos mensajes en tu móvil en unos segundos, el de prueba y un ejemplo de cómo se verá un aviso de bolsa u oro (con cifras inventadas). Si no suenan, mira que sigues suscrito al mismo tema y que la app puede avisarte.`
            : `No se pudo enviar por ${failed.map((c) => `${c.name} (${c.error ?? 'sin detalle'})`).join(' ni ')}.${
                failed.length < channels.length ? ' El resto sí salió.' : ''
              }`,
      )
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(false)
    }
  }

  const runNow = async () => {
    setRunning(true)
    setNote(null)
    try {
      const { run } = await runWatchNow()
      setNote(
        !run
          ? 'El servidor no devolvió el resultado del repaso.'
          : run.status === 'skipped'
            ? run.reason === 'recent'
              ? 'Ya se repasó hace unos minutos: no hacía falta repetirlo.'
              : 'Hay otro repaso en marcha; vuelve a mirar en un momento.'
            : run.status === 'failed'
              ? `El repaso falló: ${run.reason ?? run.errors[0] ?? 'error desconocido'}`
              : `Repaso hecho: ${plural(run.scanned, 'lectura', 'lecturas')} de velas, ${plural(run.added, 'señal nueva', 'señales nuevas')}${
                  run.closed ? ` y ${plural(run.closed, 'cierre', 'cierres')}` : ''
                }.`,
      )
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
      await client.invalidateQueries({ queryKey: ['watch-ledger'] })
      await client.invalidateQueries({ queryKey: ['watch-meta'] })
    }
  }

  if (q.isLoading) {
    return (
      <div className="view-loading" aria-busy="true">
        <Skeleton height={96} />
        <Skeleton height={280} />
      </div>
    )
  }
  if (q.error && !state) {
    return <ErrorNotice title="No se pudo leer el seguimiento" message={q.error.message} />
  }
  if (!state?.enabled) {
    return (
      <Card title="El seguimiento no tiene dónde guardarse">
        <div className="prose idle">
          <p>
            El registro es un fichero que escribe el servidor, y este despliegue no tiene dónde. Enlaza un almacén{' '}
            <strong>Blob</strong> de Vercel al proyecto (es el mismo que usa el historial del patrimonio) y vuelve a
            desplegar: la variable <code>BLOB_READ_WRITE_TOKEN</code> aparece sola.
          </p>
          <p className="sub">
            En local se guarda en <code>.watch/</code> sin configurar nada, para poder probarlo con{' '}
            <code>npm run dev</code>.
          </p>
        </div>
      </Card>
    )
  }

  const now = Date.now()
  const closedAll = entries.filter((e) => e.status === 'closed' && e.resultR !== undefined)
  const openAll = entries.filter((e) => e.status === 'open')
  const channels = state.config.channels
  const contracts = ledger ? Math.max(0, ...Object.values(ledger.universe).map((u) => u.length)) : 0
  const weeks = ledger ? Math.max(1 / 7, (now - ledger.startedAt) / (7 * 86_400_000)) : 1

  const sorted = [...entries].sort((a, b) => b.at - a.at)
  const visible = all ? sorted.slice(0, 300) : sorted.slice(0, SHOWN)

  return (
    <>
      <div className="summary">
        {!ledger || ledger.runs === 0 ? (
          <p>
            El servidor todavía no ha repasado el mercado. Pulsa <strong>Repasar ahora</strong>: a partir de ese momento
            apunta cada señal nueva de las estrategias medidas y la sigue hasta que acaba.
          </p>
        ) : entries.length === 0 ? (
          <p>
            Vigilando desde el <strong>{dateTime(ledger.startedAt)}</strong>, {plural(contracts, 'contrato', 'contratos')} por
            estrategia. Todavía no ha salido ninguna señal nueva: la primera aparece cuando una vela cierra con una
            ruptura o un cruce. Lo que ya estaba en marcha antes de empezar no se apunta, porque eso no sería
            seguimiento sino histórico.
          </p>
        ) : (
          <p>
            Desde el <strong>{dateTime(ledger.startedAt)}</strong> se han apuntado{' '}
            <strong>{plural(entries.length, 'señal', 'señales')}</strong>: {closedAll.length} cerradas y {openAll.length}{' '}
            abiertas. Las cerradas son sobre todo pérdidas —una tendencia corta rápido y deja correr—, así que no se
            leen solas: cada señal se compara con lo que valían las del histórico a su edad, y mientras la diferencia
            esté dentro de la banda de ruido <strong>no dice nada</strong> a favor ni en contra de lo medido.
          </p>
        )}
      </div>

      <div className="kpi-row">
        <Stat
          label="Señales apuntadas"
          hero
          value={String(entries.length)}
          help={HELP.trackingLedger}
          foot={
            <span>
              {closedAll.length} cerradas · {openAll.length} abiertas
            </span>
          }
        />
        <Stat
          label="Contratos vigilados"
          value={String(contracts)}
          foot={<span>los más negociados · BTC, ETH y SOL para la reversión diaria</span>}
        />
        <Stat
          label="Último repaso"
          value={ledger?.lastRun ? timeAgo(ledger.lastRun) : '—'}
          foot={
            <span>
              {ledger ? plural(ledger.runs, 'repaso', 'repasos') : '0 repasos'} · avisos:{' '}
              {channels.length ? channels.join(' y ') : 'sin configurar'}
            </span>
          }
        />
        <article className="stat stat--actions">
          <div className="stat-header">
            <p className="stat-label">Repasar</p>
          </div>
          <div className="tracking-actions">
            <button type="button" className="btn btn--primary" onClick={runNow} disabled={running}>
              {running ? 'Repasando…' : 'Repasar ahora'}
            </button>
            <button
              type="button"
              className="btn btn--outline"
              onClick={sendTest}
              disabled={testing || channels.length === 0}
              title={
                channels.length === 0
                  ? 'Sin canal configurado: define NTFY_TOPIC (o TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID) en Vercel y despliega.'
                  : `Manda un mensaje de prueba por ${channels.join(' y ')}, sin esperar a una señal.`
              }
            >
              {testing ? 'Enviando…' : 'Probar aviso'}
            </button>
          </div>
          <div className="stat-foot">
            <span>{note ?? 'El servidor lo hace solo cada hora que la app está abierta y una vez al día'}</span>
          </div>
        </article>
      </div>

      {ledger?.lastError && (
        <Card title="El último repaso tuvo un problema">
          <p className="sub">{ledger.lastError}</p>
        </Card>
      )}

      <Card
        title="Cómo van, frente a lo medido"
        subtitle="Cada señal, abierta o cerrada, contra lo que valían las del histórico a su misma edad"
        action={<Help label="Cómo se lee">{HELP.trackingVersus}</Help>}
        flush
      >
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Estrategia</th>
                <th className="num">Señales</th>
                <th className="num">Hoy por señal</th>
                <th className="num">Histórico a su edad</th>
                <th className="num">Diferencia</th>
                <th>Lectura</th>
                <th>Hacen falta</th>
              </tr>
            </thead>
            <tbody>
              {tracks.map((key) => {
                const s = trackStats(entries, key, ledger?.processed ?? {})
                const ref = REFERENCE[key]
                const need = ref ? tradesToTell(ref, key) : NaN
                const v = s.versus
                const reading = READING[readLive(s)]
                const perWeek = s.closed / weeks
                const eta = s.closed >= MIN_SAMPLE && perWeek > 0 && need > s.closed ? (need - s.closed) / perWeek : NaN
                const watched = ledger?.universe[key]?.length ?? 0
                const thin = !v || v.n < MIN_READ
                return (
                  <tr key={key} className={s.entries === 0 ? 'dust-row' : undefined}>
                    <td>
                      <span>
                        {trackLabel(key)}{' '}
                        <span className="sub">
                          · {key.startsWith('reversal') ? 'BTC, ETH, SOL' : plural(watched, 'contrato', 'contratos')}
                        </span>
                      </span>
                    </td>
                    <td className="num">
                      <span className="tracking-count">
                        <span>
                          {s.entries}
                          {s.open > 0 && <span className="sub"> · {s.open} abiertas</span>}
                        </span>
                        {s.closed > 0 && (
                          <span
                            className="sub"
                            title="Las que cierran primero son las perdedoras: mientras el registro es joven esta media sale muy baja y no quiere decir nada."
                          >
                            {s.closed} cerradas · {signedR(s.meanNet)} R
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="num">
                      {v ? thin ? <span className="sub">{signedR(v.mean)} R</span> : `${signedR(v.mean)} R` : <span className="sub">—</span>}
                    </td>
                    <td className="num">{v ? `${signedR(v.expected)} R` : <span className="sub">—</span>}</td>
                    <td className="num">
                      {v && !thin ? (
                        <span>
                          {/* Coloured only where it is outside the band: inside it a red number would read as a verdict. */}
                          {Math.abs(v.diff) > v.band ? (
                            <DeltaValue value={v.diff}>
                              <strong>{signedR(v.diff)} R</strong>
                            </DeltaValue>
                          ) : (
                            <strong>{signedR(v.diff)} R</strong>
                          )}{' '}
                          <span className="sub">± {ratio(v.band, 1)}</span>
                        </span>
                      ) : (
                        <span className="sub">—</span>
                      )}
                    </td>
                    <td>
                      <span title={reading.title}>
                        <Badge variant={reading.variant}>{reading.label}</Badge>
                      </span>
                    </td>
                    <td>
                      {ref ? (
                        <span className="tracking-progress">
                          <ProgressBar value={s.closed} max={need} />
                          <span className="sub">
                            {s.closed} de ~{thousands(need)}
                            {weeksText(eta) ? ` · a este ritmo, ${weeksText(eta)}` : ''}
                          </span>
                          <span className="sub" title={ref.sample}>
                            medido al final {signedR(ref.net)} R · {thousands(ref.n)} operaciones
                          </span>
                        </span>
                      ) : (
                        <span className="sub">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableWrap>
        <p className="ema-rest">
          <strong>Hoy por señal</strong> cuenta cada señal por lo que vale ahora: la cerrada, por su resultado neto de
          comisiones; la abierta, al último cierre. <strong>Histórico a su edad</strong> es lo que valían las del
          histórico (30 criptos desde 2022; para la pista de bolsa, 20 ETF de índices y sectores desde 1993, con la edad
          en días naturales) con esa misma edad, cerradas o no. <strong>Hacen falta</strong> son las
          operaciones cerradas que necesita una media como la medida al final del histórico para distinguirse de
          cero, contando que las señales simultáneas no son independientes:{' '}
          <Help label="Cuántas hacen falta">{HELP.trackingNeeded}</Help>
        </p>
      </Card>

      <Card
        title="Lo que dijo el histórico, puesto a prueba en vivo"
        subtitle="Las divisiones que separaron las entradas en el histórico, con operaciones que entonces no existían"
        action={<Help label="Prueba en vivo">{HELP.trackingForward}</Help>}
        flush
      >
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Estrategia</th>
                <th>Qué se partió</th>
                <th className="num">Histórico: con</th>
                <th className="num">Histórico: sin</th>
                <th className="num">En vivo: con</th>
                <th className="num">En vivo: sin</th>
              </tr>
            </thead>
            <tbody>
              {tracks
                .filter((key) => key in CONTEXT_EVIDENCE)
                .flatMap((key) => {
                  const ev = CONTEXT_EVIDENCE[key]
                  const live = contextSplits(entries, key, ledger?.processed ?? {})
                  const rows: { what: string; hist: [SplitStat, SplitStat]; live: [SplitStat, SplitStat] }[] = [
                    {
                      what: `Vela de entrada con volumen ≥ ${ratio(HIGH_VOLUME, 1)}× la media`,
                      hist: [
                        { n: ev.volume.nWith, mean: ev.volume.with },
                        { n: ev.volume.nWithout, mean: ev.volume.without },
                      ],
                      live: [live.volume.with, live.volume.without],
                    },
                    {
                      what: 'Longs con BTC sobre su EMA 200 (frente a debajo)',
                      hist: [
                        { n: ev.longs.nWith, mean: ev.longs.with },
                        { n: ev.longs.nWithout, mean: ev.longs.without },
                      ],
                      live: [live.longs.with, live.longs.without],
                    },
                    {
                      what: 'La vela cierra en fin de semana',
                      hist: [
                        { n: ev.weekend.nWith, mean: ev.weekend.with },
                        { n: ev.weekend.nWithout, mean: ev.weekend.without },
                      ],
                      live: [live.weekend.with, live.weekend.without],
                    },
                  ]
                  return rows.map((r, i) => (
                    <tr key={`${key}-${i}`}>
                      <td>{i === 0 ? trackLabel(key) : <span className="sub">{trackLabel(key)}</span>}</td>
                      <td className="watch-what">{r.what}</td>
                      <td className="num">
                        <Split s={r.hist[0]} />
                      </td>
                      <td className="num">
                        <Split s={r.hist[1]} />
                      </td>
                      <td className="num">
                        <Split s={r.live[0]} strong />
                      </td>
                      <td className="num">
                        <Split s={r.live[1]} strong />
                      </td>
                    </tr>
                  ))
                })}
            </tbody>
          </table>
        </TableWrap>
        <p className="ema-rest">
          Histórico: la media neta final de cada mitad, en R, y cuántas operaciones. En vivo: cuánto por encima o por
          debajo de lo que valía una señal de esa estrategia a su edad está cada mitad — no la media a secas, que
          mezclaría la edad de las señales con lo que se parte. Con menos de {MIN_SAMPLE} señales se deja un guion. Si
          dentro de unos meses «con» no queda por encima de «sin», lo que el histórico encontró era de ese
          histórico.
        </p>
      </Card>

      <Card
        title="Señales apuntadas"
        subtitle={
          entries.length > visible.length
            ? `Las ${visible.length} más recientes de ${entries.length}`
            : `${plural(entries.length, 'señal', 'señales')}, las más recientes primero`
        }
        flush
      >
        {entries.length === 0 ? (
          <EmptyState
            title="Aún no hay señales apuntadas"
            hint="Aparecerán aquí cuando una vela cierre con una señal de las estrategias medidas, sobre los contratos vigilados."
          />
        ) : (
          <>
            <TableWrap>
              <table className="data">
                <thead>
                  <tr>
                    <th>Cierre de la vela</th>
                    <th>Contrato</th>
                    <th>Estrategia</th>
                    <th>Lado</th>
                    <th className="num">Entrada</th>
                    <th className="num">Stop</th>
                    <th>Estado</th>
                    <th className="num">Resultado</th>
                    <th>Contexto</th>
                    <th>Gráfico</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((e) => (
                    <SignalRow key={e.id} e={e} />
                  ))}
                </tbody>
              </table>
            </TableWrap>
            {entries.length > SHOWN && (
              <p className="ema-rest">
                <button type="button" className="card-link" onClick={() => setAll((v) => !v)}>
                  {all ? 'Mostrar solo las más recientes' : `Mostrar hasta ${Math.min(entries.length, 300)}`}
                </button>
              </p>
            )}
          </>
        )}
      </Card>

      <Card title="Cómo funciona" flush>
        <div className="prose idle">
          <p>
            Cada vez que cierra una vela de 4 h, de 1 h o la diaria, el servidor recalcula las estrategias que la app
            ofrece sobre los {state.config.top} contratos más negociados (BTC, ETH y SOL para la reversión) y apunta lo
            que haya salido <strong>después</strong> de que el contrato entrara en vigilancia. Lo resuelve con las
            velas siguientes: el stop, el trailing y la salida son los de la regla. Nada de esto toca tu cuenta.
          </p>
          <p>
            Corre solo en tres sitios, y da igual cuál: el cron diario de Vercel (que puede retrasarse casi una hora),
            esta página cada hora que está abierta y, si lo configuras, un planificador externo: hay un flujo de
            GitHub Actions listo en <code>.github/workflows/watch.yml</code>, que en la práctica llega cada una o dos
            horas porque GitHub retrasa y salta ejecuciones. Repasar dos veces no duplica nada.
          </p>
          <p>
            <strong>Avisos.</strong> Define <code>NTFY_TOPIC</code> (un nombre largo y aleatorio) o{' '}
            <code>TELEGRAM_BOT_TOKEN</code> y <code>TELEGRAM_CHAT_ID</code> en Vercel y llegará un mensaje por cada
            señal nueva de 4 h o diaria, con su stop, lo medido y el contexto. Por defecto la de 1 h se apunta sin
            avisar: sale varias veces al día. <code>WATCH_ALERT_BARS</code> y <code>WATCH_ALERT_SIDES</code> lo
            cambian. La pista de bolsa, ETF y oro avisa de índices, materias primas y acciones tras el cierre de Nueva
            York (no de los ETF apalancados, que midieron sin ventaja): <code>WATCH_TRAD_KINDS</code> elige cuáles,{' '}
            <code>WATCH_TRAD_ALERT=off</code> la deja solo apuntando y <code>WATCH_TRAD=off</code> la apaga. Tampoco avisa de un
            contrato cuyo libro de OKX hace que entrar y salir con {new Intl.NumberFormat('es-ES').format(TRAD_LIQUIDITY.refUsd)} $ cueste más de{' '}
            {ratio(TRAD_LIQUIDITY.maxCostR)} R de horquilla: se apunta y se sigue igual, y la fila lo dice (<code>WATCH_TRAD_MAX_COST_R</code>{' '}
            cambia el tope; <code>off</code> los avisa todos).{' '}
            {channels.length ? (
              <>
                Ahora mismo hay configurado: <strong>{channels.join(' y ')}</strong>.
              </>
            ) : (
              <>Ahora mismo no hay ningún canal configurado, y el servidor solo apunta.</>
            )}
          </p>
        </div>
      </Card>
    </>
  )
}

function SignalRow({ e }: { e: LedgerEntry }) {
  const tags = entryTags(e)
  const open = e.status === 'open'
  const result = currentR(e)
  const trad = isTradTrack(e.track)
  const fmt = trad ? quote : price
  return (
    <tr>
      <td>{dateTime(e.at)}</td>
      <td>
        <span>
          <span className="ccy">{e.symbol}</span>
          {trad && e.kind && <span className="sub"> · {TRAD_KIND[e.kind].label.toLowerCase()}</span>}
        </span>
      </td>
      <td className="watch-what">{trackLabel(e.track)}</td>
      <td>
        <SideBadge side={e.side} />
      </td>
      <td className="num">{fmt(e.entry)}</td>
      <td className="num">
        <span>
          {fmt(open ? (e.stopNow ?? e.stop) : e.stop)}
          {open && e.stopNow !== undefined && e.stopNow !== e.stop && <span className="sub"> · sube</span>}
        </span>
      </td>
      <td>
        <span className="watch-signal">
          <Badge variant={open ? 'live' : 'neutral'}>{open ? 'Abierta' : 'Cerrada'}</Badge>
          {e.alert && (
            <span className="sub" title={e.alert === 'illiquid' ? 'El libro de OKX no admitía un tamaño normal a un precio razonable: se apunta y se sigue, pero no se avisó.' : undefined}>
              {e.alert === 'sent' ? 'avisada' : e.alert === 'illiquid' ? 'sin aviso: poca liquidez' : 'aviso fallido'}
            </span>
          )}
        </span>
      </td>
      <td className="num">
        {open && e.markR === undefined ? (
          <span className="sub">—</span>
        ) : (
          <span>
            <DeltaValue value={result}>{signedR(result)} R</DeltaValue>
            {open && <span className="sub"> · al cierre</span>}
          </span>
        )}
      </td>
      <td>
        <span className="watch-signal">
          {tags.length === 0 ? (
            <span className="sub">—</span>
          ) : (
            tags.map((t) => (
              <span key={t.key} title={t.note}>
                <Badge variant={t.tone === 'warn' ? 'warn' : 'neutral'}>{t.label}</Badge>
              </span>
            ))
          )}
        </span>
      </td>
      <td>
        {trad ? (
          // An equity has no strategy chart of its own: the rule reads the underlying's history. Its card is in the Screener.
          <a className="card-link" href={routeHref('analisis', { inst: e.okxId ?? e.instId })}>
            Ver →
          </a>
        ) : (
          <a className="card-link" href={routeHref('estrategias', { inst: e.instId, s: e.strategy, p: e.preset, tf: e.bar })}>
            Ver →
          </a>
        )}
      </td>
    </tr>
  )
}
