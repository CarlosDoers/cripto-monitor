import { useRef, type ReactNode } from 'react'
import { Card } from '../components/ui'
import { HELP } from '../lib/glossary'
import { CARRY_EVIDENCE } from '../lib/carry'
import { pct } from '../lib/format'

/**
 * The Guía: how to read each section, how to use SMC and the Screener, what
 * has been measured to work and what has not, and every term in one place.
 *
 * The measured findings were the most valuable knowledge in the project and
 * lived only in CLAUDE.md, where the person using the app never reads. Every
 * figure here is one a script prints (`npm run audit`, `smc`, `screener`,
 * `trendlines`, `ma`, `levels:sweep`); if a strategy is re-measured, this page
 * must be updated with it.
 */

const GLOSSARY: [string, keyof typeof HELP][] = [
  ['Acierto (tasa de aciertos)', 'winRate'],
  ['Amplitud del mercado', 'breadth'],
  ['Apalancamiento máximo', 'maxLeverage'],
  ['Aportación neta', 'netContribution'],
  ['Bot más apurado', 'tightestBot'],
  ['Capital comprometido (bots)', 'committed'],
  ['Cobertura (spot)', 'coverage'],
  ['Costes totales', 'totalCosts'],
  ['Depósitos', 'deposits'],
  ['Dinero disponible (margen libre)', 'freeMargin'],
  ['Distancia a liquidación', 'liqDistance'],
  ['Duración media', 'duration'],
  ['Esperanza por operación', 'expectancy'],
  ['Esperanza en R', 'expectancyR'],
  ['Factor de beneficio', 'profitFactor'],
  ['Financiación (funding)', 'funding'],
  ['Ganancia abierta (PnL no realizado)', 'unrealisedPnl'],
  ['Generado operando', 'tradingResult'],
  ['Horquilla (spread)', 'spread'],
  ['Margen usado', 'marginUsed'],
  ['Operabilidad', 'tradability'],
  ['Órdenes de seguridad usadas', 'fuelUsed'],
  ['Patrimonio total', 'netWorth'],
  ['PnL de los bots', 'botPnl'],
  ['PnL realizado (30 días)', 'realisedPnl30'],
  ['Posición abierta (open interest)', 'openInterest'],
  ['Precio de liquidación', 'liqPrice'],
  ['Precio marca', 'markPrice'],
  ['Prima sobre el índice', 'basis'],
  ['Protección (stop)', 'protection'],
  ['R (unidad de riesgo)', 'r'],
  ['Racha', 'streak'],
  ['Rango 24 h', 'range24h'],
  ['Ratio de margen', 'marginRatio'],
  ['Resultado en spot', 'spotResult'],
  ['Resultado total', 'totalResult'],
  ['ROI', 'roi'],
  ['RSI', 'rsi'],
  ['Screener: qué anticipan los atajos', 'screener'],
  ['Sin coste conocido (spot)', 'uncovered'],
  ['Smart Money Concepts (SMC)', 'smc'],
  ['Tamaño total (nocional)', 'notional'],
  ['Volatilidad', 'volatility'],
  ['Volumen relativo', 'relVolume'],
]

type Verdict = 'si' | 'no' | 'ojo'

/** What the measurements say, in plain words. Each line traces to a script in CLAUDE.md. */
const FINDINGS: { verdict: Verdict; what: string; detail: ReactNode }[] = [
  {
    verdict: 'si',
    what: 'Reversión en diario',
    detail: (
      <>
        La que más gana por operación: <strong>+0,43 R</strong> por señal, positiva en BTC, ETH y SOL
        por separado, en todos los años y en largos y cortos. Pero menos sólida de lo que parecía: el
        ancho de banda elegido es un pico (con 2 o 3 ATR la segunda mitad del histórico queda en cero),
        y su ventaja aguantaría solo 6 variantes probadas. Hasta octubre de 2026 la app decía +0,61 R
        porque el backtest no contaba el stop tocado el día después de la entrada.
      </>
    ),
  },
  {
    verdict: 'si',
    what: 'Ruptura (Donchian) en 4 h',
    detail: (
      <>
        <strong>+0,33 R</strong> por señal, pero vive de pocas operaciones grandes: sin sus diez mejores
        de 899 queda en +0,07. Y es la que peor aguanta la búsqueda que la encontró: seguiría siendo
        real solo si se hubieran probado menos de 14 variantes, y se probaron más. Espera rachas
        largas de pérdidas y úsala con tamaño pequeño.
      </>
    ),
  },
  {
    verdict: 'si',
    what: 'Cruce de la EMA 200 en 4 h',
    detail: (
      <>
        La única de 162 combinaciones de EMA (9 longitudes, 1 h, 4 h y diario, cruce, rebote o retroceso, dos
        salidas) que pasó el listón: <strong>+0,19 R</strong> por operación en 30 criptos, con las EMAs vecinas
        también positivas y casi sin relación con la Ruptura. Vive de pocas tendencias largas y su ventaja ha ido
        bajando. En el Screener, «Qué vigilo» dice qué X-Perp acaban de cruzar o están a punto.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'Rebotes en la EMA (25, 50…) y retrocesos a ella',
    detail: (
      <>
        Tocar la media y rebotar no es más probable que con cualquier otra línea que siga al precio, aunque lo
        confirmen el volumen o la estructura. Operado, en diario pierde o empata; las pocas variantes con números
        buenos viven de cinco tendencias enormes.
      </>
    ),
  },
  {
    verdict: 'si',
    what: 'Apertura de Nueva York en 15 m, días laborables',
    detail: (
      <>
        <strong>+0,25 R</strong> por señal, sobre más de 4.000 operaciones: aguantaría haber sido la
        mejor de cien mil variantes. Su ventaja se ha ido estrechando año a año, y cada entrada es una
        orden stop: el deslizamiento importa.
      </>
    ),
  },
  {
    verdict: 'si',
    what: 'Cobrar la financiación cubriendo lo que tienes (carry)',
    detail: (
      <>
        Tener la moneda y un corto del mismo tamaño en su perpetuo, mientras la financiación pague:{' '}
        <strong>{pct(CARRY_EVIDENCE.ownApr, 1)} anual</strong> desde 2022 en {CARRY_EVIDENCE.coins}{' '}
        monedas, positivo en las dos mitades del histórico, y casi sin relación con las estrategias.
        No es una predicción sino un cobro, con sus riesgos: el margen del corto y que la financiación se
        gire. Está en la sección Financiación.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'Ir contra la financiación extrema',
    detail: (
      <>
        Ponerse corto cuando la financiación está en su décimo más alto perdió un{' '}
        {pct(CARRY_EVIDENCE.contrarianShortWeekly, 1)} por semana: cuando hay muchos largos, el precio
        suele seguir subiendo. Ordenar el tablero por financiación (largo en la baja, corto en la alta)
        tampoco funcionó: un año gana y el siguiente pierde lo mismo.
      </>
    ),
  },
  {
    verdict: 'si',
    what: 'Ninguna señal mira el futuro ni se borra después',
    detail: (
      <>
        Cada señal de las estrategias y cada ruptura del SMC se ha recalculado con solo las velas de
        su momento: todas aparecen igual y ninguna desaparece. Y lo que calcula la app con las ~1.200
        velas que descarga coincide con lo medido sobre años de historia.
      </>
    ),
  },
  {
    verdict: 'ojo',
    what: 'Las comisiones deciden la temporalidad',
    detail: (
      <>
        En 15 m un stop está tan cerca que una comisión normal se come 0,4 R por operación. Por eso las
        estrategias bloquean las temporalidades cortas: no es que fallen más, es que cuesta más.
      </>
    ),
  },
  {
    verdict: 'ojo',
    what: 'Acertar mucho no es ganar',
    detail: (
      <>
        Con entradas al azar y un stop lejano frente a un objetivo cercano se acierta un 73 % y se
        pierde dinero. Mira siempre la esperanza, no solo el porcentaje de aciertos.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'Soportes, resistencias y líneas de tendencia como señal',
    detail: (
      <>
        El precio «respeta» una línea puesta al azar tantas veces como estas, en torno al 70 %.
        Operar el rebote o la ruptura pierde. Sirven para describir el gráfico, no para predecir.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'Medias de 50 y 200 como soporte',
    detail: <>No reaccionan más que una copia desplazada al azar. Contexto, no señal.</>,
  },
  {
    verdict: 'no',
    what: 'Volver al order block (SMC)',
    detail: (
      <>
        Pierde en todas las temporalidades, también con las reglas «Enhanced». Entre el 83 y el 94 % de
        los order blocks se tocan tarde o temprano: tocarlos no significa nada.
      </>
    ),
  },
  {
    verdict: 'ojo',
    what: 'Rupturas de estructura SMC en 4 h',
    detail: (
      <>
        Ganan (+0,20 R), pero coinciden en la mitad de sus operaciones con la estrategia Ruptura, y
        solo aguantarían 7 variantes probadas: del SMC se probaron cinco formas de operarlo. No es
        suficiente para ofrecerla como estrategia.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'Sobreventa (RSI < 30) para comprar el rebote',
    detail: <>No anticipa ningún rebote frente al resto del mercado la semana siguiente.</>,
  },
  {
    verdict: 'ojo',
    what: 'Sobrecompra y volumen inusual',
    detail: (
      <>
        Ganan de media solo por unas pocas subidas enormes: el caso típico se queda por detrás del
        resto. Es una lotería, no una ventaja.
      </>
    ),
  },
  {
    verdict: 'si',
    what: 'CHoCH bajista como aviso',
    detail: (
      <>
        Tras un cambio de carácter bajista, el contrato va de media un <strong>1 % peor</strong> que el
        resto la semana siguiente. Poco, pero consistente: úsalo para no entrar en largo.
      </>
    ),
  },
]

const VERDICT_LABEL: Record<Verdict, string> = { si: 'Funciona', no: 'No funciona', ojo: 'Matiz' }

function Section({ id, title, children, refs }: {
  id: string
  title: string
  children: ReactNode
  refs: React.RefObject<Record<string, HTMLElement | null>>
}) {
  return (
    <section
      ref={(el) => {
        refs.current[id] = el
      }}
    >
      <Card title={title}>
        <div className="prose guide">{children}</div>
      </Card>
    </section>
  )
}

export function Guide() {
  const refs = useRef<Record<string, HTMLElement | null>>({})
  const toc = [
    ['mapa', 'Cómo está organizada'],
    ['dia', 'Un repaso en cinco minutos'],
    ['smc', 'Cómo leer el SMC'],
    ['screener', 'Cómo usar el Screener'],
    ['medido', 'Qué funciona y qué no'],
    ['glosario', 'Glosario'],
  ] as const

  return (
    <>
      {/* The routing uses the hash, so in-page anchors would change the
          section; the index scrolls instead. */}
      <div className="tabs guide-toc" role="navigation" aria-label="Índice de la guía">
        {toc.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="tab"
            onClick={() => refs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            <span className="tab-label">{label}</span>
          </button>
        ))}
      </div>

      <Section id="mapa" title="Cómo está organizada la app" refs={refs}>
        <p>Cada sección responde a una pregunta. En el menú están agrupadas en dos bloques.</p>
        <h3>Tu cuenta</h3>
        <ul>
          <li>
            <strong>Resumen</strong>: ¿cómo voy? Lo que has ganado desde que empezaste, lo que tienes en
            marcha, cualquier aviso de riesgo y las <em>oportunidades ahora</em>: los X-Perp donde la
            Reversión tiene una señal viva que todavía merece la pena. Si solo miras una sección, que sea
            esta.
          </li>
          <li>
            <strong>En curso</strong>: lo que tienes abierto ahora (posiciones, bots, órdenes
            pendientes) con su riesgo: distancia a la liquidación, si tiene stop, cuánto le queda a cada
            bot.
          </li>
          <li>
            <strong>Cartera</strong>: qué monedas tienes, cuánto valen y cuánto dinero está disponible
            frente a comprometido.
          </li>
          <li>
            <strong>Rendimiento</strong>: tus operaciones cerradas analizadas: qué activos, qué lado,
            qué horas y qué días te dan o te quitan dinero.
          </li>
          <li>
            <strong>Historial</strong>: el registro de todo: órdenes, ejecuciones, bots detenidos,
            depósitos y movimientos. Arriba, cuánto has aportado y cuánto has ganado.
          </li>
        </ul>
        <h3>El mercado</h3>
        <ul>
          <li>
            <strong>Mercados</strong>: el pulso del día: qué sube, qué baja, cuánto se negocia, y tus
            contratos de un vistazo.
          </li>
          <li>
            <strong>Screener</strong>: filtra todo el tablero para encontrar qué mirar (sobrecompra,
            rupturas, volumen inusual, tus indicadores…).
          </li>
          <li>
            <strong>Análisis</strong>: el gráfico de cualquier contrato con soportes, tendencias,
            estructura SMC y medias, en cualquier temporalidad. Para leer, no para operar.
          </li>
          <li>
            <strong>Estrategias</strong>: las cuatro estrategias que se han medido con años de datos, con
            su señal actual y su historial. Solo se ofrecen en las temporalidades donde ganan.
          </li>
        </ul>
        <p className="sub">
          Los «?» junto a cada cifra explican qué es y qué hacer con ella. Todos están también en el
          glosario, al final de esta página.
        </p>
      </Section>

      <Section id="dia" title="Un repaso en cinco minutos" refs={refs}>
        <ol>
          <li>
            <strong>Resumen.</strong> Lee la frase de arriba. Si aparece «Requiere atención», resuélvelo
            primero: una posición sin stop o un bot sin órdenes de seguridad es dinero expuesto.
          </li>
          <li>
            <strong>En curso</strong>, si tienes algo abierto: mira la distancia a la liquidación y que
            todo tenga protección.
          </li>
          <li>
            <strong>Mercados</strong>: ¿el mercado entero sube o baja? La amplitud te dice si es un
            movimiento general o de unos pocos.
          </li>
          <li>
            <strong>Oportunidades ahora</strong>, en el Resumen: las señales vivas de la Reversión,
            ordenadas por el recorrido que les queda. Ábrelas en Estrategias para ver el gráfico, y decide
            tú el tamaño: aproximadamente la mitad acaban en el stop.
          </li>
          <li>
            <strong>Análisis</strong> del contrato que te interese, con el SMC activado, antes de decidir
            nada: dirección, fase y dónde quedaría invalidada la idea.
          </li>
        </ol>
      </Section>

      <Section id="smc" title="Cómo leer el SMC (Análisis → botón SMC)" refs={refs}>
        <ul>
          <li>
            <strong>Estructura principal</strong> (línea continua, giros de 50 velas): marca el sentido.
            Alcista, piensa en largos; bajista, en cortos. Mírala en 4 h o en diario.
          </li>
          <li>
            <strong>Estructura interna</strong> (discontinua, giros de 5 velas): marca la fase. Si va en
            contra de la principal, es un retroceso dentro de la tendencia, no un cambio. Un CHoCH interno
            de vuelta a favor sugiere que el retroceso ha terminado.
          </li>
          <li>
            <strong>BOS</strong>: la tendencia continúa. <strong>CHoCH</strong>: la tendencia cambia.
          </li>
          <li>
            <strong>Premium / descuento</strong>: en tendencia alcista, comprar en premium (mitad alta del
            rango) es perseguir el precio; el descuento es mejor sitio. Al revés en bajista.
          </li>
          <li>
            <strong>Mínimo o máximo fuerte</strong>: tu línea de invalidación. Si el precio cierra al
            otro lado, la tendencia ha cambiado: referencia natural para el stop.
          </li>
          <li>
            <strong>Order blocks</strong> (azul y rosa; en gris si el precio ya volvió a ellos) y{' '}
            <strong>FVG</strong>: zonas de referencia para stops y objetivos, no motivos para entrar.
          </li>
          <li>
            <strong>EQH / EQL</strong>: máximos o mínimos casi iguales, donde se acumulan órdenes. El
            precio suele ir a por ellos.
          </li>
        </ul>
        <p className="sub">
          Lo que no conviene: comprar solo porque el precio toca un order block (pierde en todas las
          temporalidades) u operar cada ruptura por su cuenta (para eso está la estrategia Ruptura).
        </p>
      </Section>

      <Section id="screener" title="Cómo usar el Screener" refs={refs}>
        <ul>
          <li>
            <strong>Atajos</strong> (la tira de arriba): un clic pone los filtros y el orden. Los más
            útiles: <em>Reversión</em> (dónde vigila o ha dado señal la estrategia), <em>CHoCH reciente</em>{' '}
            (qué ha cambiado de tendencia) y <em>Volumen inusual</em> (dónde entra dinero).
          </li>
          <li>
            <strong>Filtros</strong>: combínalos para buscar algo concreto, por ejemplo «acciones en
            tendencia alcista sin sobrecompra».
          </li>
          <li>
            <strong>Vistas</strong>: <em>Rendimiento</em> para ver quién lidera, <em>Técnico</em> para RSI y
            medias, <em>Gráficos</em> para verlo todo de un vistazo. Pulsa en una columna para ordenar.
          </li>
          <li>
            Los técnicos solo existen para los 80 contratos con más volumen, y con unos 180 días de
            historia: no hay media de 200 ni máximo anual.
          </li>
        </ul>
        <p className="sub">
          Úsalo para encontrar qué mirar, no para decidir qué comprar: ningún atajo elige de forma fiable
          lo que subirá más (ver «Qué funciona y qué no»).
        </p>
      </Section>

      <Section id="medido" title="Qué funciona y qué no (medido con años de datos)" refs={refs}>
        <p>
          Todo lo que la app dice sobre si algo funciona se ha medido sobre años de datos, con
          comisiones, en las dos mitades del histórico y contra entradas al azar. Esto es lo que salió.
        </p>
        <ul className="findings">
          {FINDINGS.map((f) => (
            <li key={f.what} className={`finding finding--${f.verdict}`}>
              <span className="finding-verdict">{VERDICT_LABEL[f.verdict]}</span>
              <span className="finding-body">
                <strong>{f.what}.</strong> {f.detail}
              </span>
            </li>
          ))}
        </ul>
        <p className="sub">
          «R» es la unidad de riesgo: lo que pierdes si salta el stop. +0,25 R por señal significa que,
          de media, cada operación gana un cuarto de lo que arriesga.
        </p>
      </Section>

      <Section id="glosario" title="Glosario" refs={refs}>
        <dl className="glossary">
          {GLOSSARY.map(([label, key]) => (
            <div key={key} className="glossary-entry">
              <dt>{label}</dt>
              <dd>{HELP[key]}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  )
}
