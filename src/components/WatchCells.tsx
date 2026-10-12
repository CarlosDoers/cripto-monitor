import { Badge } from './ui'

/** A side as the app writes it everywhere: green Long, red Short. */
export function SideBadge({ side }: { side: 'long' | 'short' }) {
  return <Badge variant={side === 'long' ? 'buy' : 'sell'}>{side === 'long' ? 'Long' : 'Short'}</Badge>
}

/**
 * What the two columns of a "qué vigilar" card mean. They answer different
 * questions and used to share one badge beside the symbol: a contract showed
 * "Corto" (now "Short") while the entry that was forming was a long.
 */
export function WatchLegend({ label }: { label: string }) {
  return (
    <p className="ema-rest">
      <strong>Señal</strong>: la entrada que abriría la regla si la vela de {label} cierra como está (su dirección va en el
      color). <strong>Posición ahora</strong>: la que la regla ya tiene abierta — simulada, no es tu cuenta — y a ella
      pertenece el stop. Pueden ser contrarias: un short abierto con un long en camino.
    </p>
  )
}
