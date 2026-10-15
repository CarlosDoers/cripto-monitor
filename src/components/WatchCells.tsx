import type { ContextTag } from '../lib/entryContext'
import { Badge } from './ui'

/** A side as the app writes it everywhere: green Long, red Short. `note` is what was measured for it. */
export function SideBadge({ side, note }: { side: 'long' | 'short'; note?: string }) {
  const badge = <Badge variant={side === 'long' ? 'buy' : 'sell'}>{side === 'long' ? 'Long' : 'Short'}</Badge>
  return note ? <span title={note}>{badge}</span> : badge
}

/**
 * What was true when the entry was made — BTC's regime, the candle's volume, a
 * weekend close — each with what was measured for it behind its tooltip. They
 * are context, not a score: the badge turns amber on the side of a split that
 * measured worse, and never green or red, which stay for results.
 */
export function ContextTags({ tags }: { tags: ContextTag[] }) {
  if (tags.length === 0) return <span className="sub">—</span>
  return (
    <span className="watch-signal">
      {tags.map((t) => (
        <span key={t.key} title={t.note}>
          <Badge variant={t.tone === 'warn' ? 'warn' : 'neutral'}>{t.label}</Badge>
        </span>
      ))}
    </span>
  )
}

/**
 * What the columns of a "qué vigilar" card mean. They answer different
 * questions and used to share one badge beside the symbol: a contract showed
 * "Corto" (now "Short") while the entry that was forming was a long.
 */
export function WatchLegend({ label }: { label: string }) {
  return (
    <p className="ema-rest">
      <strong>Señal</strong>: la entrada que abriría la regla si la vela de {label} cierra como está (su dirección va en el
      color). <strong>Posición ahora</strong>: la que la regla ya tiene abierta — simulada, no es tu cuenta — y a ella
      pertenece el stop. Pueden ser contrarias: un short abierto con un long en camino. <strong>Contexto</strong>: lo que
      era cierto al entrar (BTC, volumen, fin de semana), con lo que se midió detrás de cada etiqueta: describe, no
      puntúa.
    </p>
  )
}
