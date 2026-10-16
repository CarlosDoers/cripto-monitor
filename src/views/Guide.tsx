import { useRef, type ReactNode } from 'react'
import { Card } from '../components/ui'
import { HELP } from '../lib/glossary'
import { CARRY_EVIDENCE } from '../lib/carry'
import { pct, ratio } from '../lib/format'
import { DONCHIAN_TREND_EVIDENCE as TREND } from '../lib/indicators/donchianBreakout'

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
  ['Seguimiento: cuántas operaciones hacen falta', 'trackingNeeded'],
  ['Seguimiento: la banda de ruido', 'trackingNoise'],
  ['Seguimiento: qué es el registro', 'trackingLedger'],
  ['Seguimiento: señales contra el histórico a su edad', 'trackingVersus'],
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
    verdict: 'ojo',
    what: 'Reversión en diario',
    detail: (
      <>
        En BTC, ETH y SOL desde 2022 es la que más gana por operación: <strong>+0,41 R</strong> por
        señal, positiva en cada una por separado, en todos los años y en longs y shorts. Pero menos
        sólida de lo que parecía: el ancho de banda elegido es un pico (con 2 o 3 ATR la segunda mitad
        del histórico queda en cero), y su ventaja aguantaría solo 5 variantes probadas. Y no se sale de
        ahí: en las otras 26 monedas del tablero mide <strong>−0,03 R</strong> sobre 759 señales
        (ninguna ventaja demostrada), y antes de 2022 pierde (−0,16 R en 2018–2021, −0,35 R en BTC,
        ETH y SOL). Es una estrategia de mercado lateral con la ventaja demostrada solo en esas tres
        monedas. Hasta octubre de 2026 la app decía +0,61 R porque el backtest no contaba el stop
        tocado el día después de la entrada.
      </>
    ),
  },
  {
    verdict: 'si',
    what: 'Ruptura (Donchian) en 4 h',
    detail: (
      <>
        <strong>+0,32 R</strong> por señal, pero vive de pocas operaciones grandes: sin sus diez mejores
        de 946 queda en +0,08. Y es la que peor aguanta la búsqueda que la encontró: seguiría siendo
        real solo si se hubieran probado menos de 15 variantes, y se probaron más. Espera rachas
        largas de pérdidas y úsala con tamaño pequeño. Con el filtro de la EMA 200 (el preset «Canal 20 +
        EMA 200», que tiene su propio «Qué vigilo» en el Screener) mide{' '}
        <strong>+{ratio(TREND.board.net)} R</strong> sobre {new Intl.NumberFormat('es-ES').format(TREND.board.n)}{' '}
        operaciones, frente a +{ratio(TREND.board.plain)} sin él, y mejora cada uno de los cinco años: los longs
        ganan +{ratio(TREND.board.longs)} R y los shorts +{ratio(TREND.board.shorts)}. Sube lo que gana cada
        operación pero quita muchas y se parece al cruce de la EMA 200, así que sirve para elegir qué rupturas
        coger, no para ganar más en conjunto.
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
    verdict: 'no',
    what: 'Apertura de Nueva York en 15 m, días laborables',
    detail: (
      <>
        Ya no se ofrece (octubre de 2026). Daba <strong>+0,25 R</strong> por señal porque el backtest
        descartaba los días en que una vela toca los dos extremos del rango, que son siempre una
        pérdida; contándolos, y con los datos hasta hoy, mide +0,22 R, pero la segunda mitad del
        histórico se queda en <strong>+0,08 R</strong>, por debajo del listón. Lo que se ha gastado es
        BTC, ETH y SOL: +0,38 R hasta mediados de 2024 y +0,05 R desde entonces. La regla sigue
        ganando a una entrada al azar; su margen ya no cubre con holgura las comisiones y el
        deslizamiento de una orden stop.
      </>
    ),
  },
  {
    verdict: 'si',
    what: 'Cobrar la financiación cubriendo lo que tienes (carry)',
    detail: (
      <>
        Tener la moneda y un short del mismo tamaño en su perpetuo, mientras la financiación pague:{' '}
        <strong>{pct(CARRY_EVIDENCE.ownApr, 1)} anual</strong> desde 2022 en {CARRY_EVIDENCE.coins}{' '}
        monedas, positivo en las dos mitades del histórico, y casi sin relación con las estrategias.
        No es una predicción sino un cobro, con sus riesgos: el margen del short y que la financiación se
        gire. Está en la sección Financiación.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'Ir contra la financiación extrema',
    detail: (
      <>
        Ponerse short cuando la financiación está en su décimo más alto perdió un{' '}
        {pct(CARRY_EVIDENCE.contrarianShortWeekly, 1)} por semana: cuando hay muchos longs, el precio
        suele seguir subiendo. Ordenar el tablero por financiación (long en la baja, short en la alta)
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
    what: 'Scalping de 1 minuto con la EMA 50 y tres gráficos (1 h, 5 m, 1 m)',
    detail: (
      <>
        Se midió la regla de un vídeo de trading en directo: dirección en 1 h, estructura de impulso y
        pullback en 5 m, entrada en 1 m, stop pegado y objetivo 1:1. Sobre 2,1 millones de velas de 1 m de
        BTC y ETH (dos años), <strong>acierta el 50,7 %</strong> —casi lo que él cuenta—, pero antes de
        comisiones gana +0,02 R por operación: el acierto es la geometría 1:1, no una ventaja. Con un stop
        de 0,17 % del precio, una ida y vuelta cuesta 0,6 R, y el resultado neto es{' '}
        <strong>−0,57 R</strong> (−0,40 R aunque todo se ejecutara como maker). Alinear 1 h y 5 m aporta
        +0,02 R, y entrar con orden límite en la media es peor todavía. Cuatro operaciones de un día
        bueno no dicen nada del método.
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
    verdict: 'ojo',
    what: 'Indicadores de TradingView: %R Trend Exhaustion, SuperTrend AI, EMA Wave',
    detail: (
      <>
        Se midieron tal como vienen, y todas las estrategias del menú del %R. Los que ganan algo lo
        hacen en 4 h y siguiendo la tendencia: la EMA Wave con sus tres ondas alineadas da +0,22 R, pero
        sus meses se mueven con los de la Ruptura (correlación 0,92) y sumarla no mejora el conjunto.
        Sin sus diez mejores operaciones se quedan en casi nada. Ninguno se ofrece: repiten una ventaja
        que la app ya tiene.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'Patrones populares de TradingView: squeeze, Ichimoku, NR7, Turtle Soup, UT Bot, velas',
    detail: (
      <>
        Se midieron tal como se cuentan, con las reglas fijadas antes y en 30 monedas desde 2022.
        Pierden o empatan el NR7 y la barra interior, el barrido de liquidez (Turtle Soup), el clímax de
        volumen, la divergencia del RSI, el UT Bot, la envolvente de Nadaraya-Watson, las velas de
        reversión en extremos, el ratio altcoin/BTC (pierde −0,2 R, con dos comisiones) y las ventanas
        horarias. Los que ganan algo —squeeze en 4 h, +0,12 R; Ichimoku en diario, +0,20 R— son
        tendencia otra vez: sus meses se mueven con los de la Ruptura (0,62) y con los de la EMA 200
        (0,90), y sin sus diez mejores operaciones se quedan en casi nada. El hueco de valor justo
        (FVG) en diario es lo único con algo propio, +0,11 R y positivo con todos sus vecinos, pero con
        un intervalo que incluye el cero y sin repetirse con claridad antes de 2022 (+0,07 R, casi todo
        de 2021). Ninguno se ofrece.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'Comprar la caída a un soporte, aunque esperes a un pivote confirmado',
    detail: (
      <>
        El autor de la clase lo dice él mismo: «no compro soportes así como así», y una de cada tres sale bien.
        Con su propia condición (un mínimo de cinco velas en un nivel, objetivo al doble del riesgo), en el
        diario de OKX sobre 22 monedas: <strong>−0,07 R</strong> por operación, y comprar cualquier mínimo
        confirmado, sin nivel, da +0,03 R: el soporte no suma nada. En 2018–21 sale +0,35 R, pero solo
        los longs, en un mercado alcista.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'Fases, retrocesos de Fibonacci y regla de tiempo (acción del precio «con niveles calculados»)',
    detail: (
      <>
        Un impulso, una corrección que no dure más de la mitad o un tercio, y entrar en el giro o en la
        ruptura del máximo para ir a por la mitad del impulso con un stop a 2 : 1. Medido tal como se cuenta,
        en el diario de OKX sobre 24 monedas (440 operaciones): <strong>−0,02 R</strong> por operación. En
        2018–21, que nadie había tocado, +0,10 R con un intervalo que incluye el cero y con los longs
        ganando y los shorts perdiendo: comprar caídas en un mercado alcista. La regla de tiempo ayuda en
        un periodo y estorba en el otro. El ejemplo del vídeo es Microsoft en 1994, elegido a posteriori.
        Los dos vídeos siguientes de la misma serie añaden el «primer pivote» (lo mismo en un impulso de
        cualquier tamaño) y salir en tres partes, al 25, al 50 y al 100 % del impulso con un solo stop:
        medidos aparte, dan −0,10 R, −0,06 R y −0,02 R en 2022–26; solo los longs de 2018–21 ganan. La
        última pieza de la serie, el stop que sigue los mínimos crecientes tras cobrar la mitad, añade +0,01 R:
        con él −0,02 R, sin él −0,03 R.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'Canales Donchian combinados con volatilidad objetivo (artículo académico de 2025)',
    detail: (
      <>
        Nueve ventanas de 5 a 360 días, solo longs, tamaño para una volatilidad del 25 % anual. En BTC desde
        2018 baja la caída máxima de −76 % a −28 % y sube el Sharpe de 0,84 a 1,01, pero mantener{' '}
        <strong>la misma exposición media</strong> ya da 0,84 y −35 %: el timing aporta +0,17 de Sharpe con
        un intervalo que incluye el cero, y en la cesta de 14 monedas aporta 0,00. Lo que reduce el riesgo es
        estar menos tiempo y con menos tamaño; la parte de tendencia es el Donchian que ya hay.
      </>
    ),
  },
  {
    verdict: 'ojo',
    what: 'Fuerza relativa semanal entre las monedas más negociadas (long-short)',
    detail: (
      <>
        Con las monedas muertas dentro (593 tramos de pares de Binance, 2018–2026), comprar cada domingo el tercio de
        los 30 más negociados más cercano a su máximo de 90 días y vender en short el más lejano gana{' '}
        <strong>+1,7 % por semana</strong> (t 5,0, positivo en los nueve años). El momentum de 1 a 4 semanas
        que se veía en la cesta actual (t 5) era supervivencia: sin ella queda en t 2 a 3 y falla en 2022 y
        2026. Tres límites: entre monedas que llevan años cotizando <strong>no existe</strong> (mediana −0,08 %
        en cestas al azar); dentro de una misma edad tampoco, porque en buena parte es{' '}
        <strong>la edad</strong> (las listadas hace poco, en caída, frente a las veteranas); y solo long
        rinde lo mismo que BTC con una caída del −84 %. No hay historial de X-Perps para medirlo en OKX. En el Screener
        hay una tarjeta de solo lectura que ordena los contratos así, con estos límites a la vista.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'Fear & Greed, «el gap del CME se cierra», oferta de stablecoins y MVRV',
    detail: (
      <>
        Comprar con miedo extremo no rinde más que un día cualquiera (90 días después, −2 % frente a +14 %), y
        las reglas pierden contra mantener a la misma exposición. El gap del CME se toca el 72–81 % de las
        veces en una semana, pero el nivel simétrico al otro lado se toca igual o más, y operarlo en contra
        pierde −0,28 R; continuar el movimiento del fin de semana ganó +0,18 R en 2022–26 y 0,00 R en 2017–21.
        La oferta de stablecoins coincide con el precio, no lo anticipa; y el MVRV bajo acierta 6 de 8 veces,
        pero una regla con él no bate a mantener a la misma exposición: son ocho ciclos.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'Base de los futuros con vencimiento y estructura de plazos',
    detail: (
      <>
        Comprar spot y vender el futuro hasta el vencimiento fija la base: en BTC, 26 contratos desde 2020,
        <strong> +7,4 % anual bruto y +6,2 % neto</strong>, con 12 de 26 por debajo del 5 % y solo +1,2 % en
        2022. La financiación del perpetuo dio +4 a +12 % en esos mismos años, así que el vencimiento no mejora
        el carry de Financiación; solo lo hace seguro. Y la base no anticipa el precio: tenerla alta equivale a
        estar sobre la media de 200 días el 91 % de las veces. Es la tendencia, no el carry.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'Pares cointegrados (arbitraje estadístico entre criptos)',
    detail: (
      <>
        Elegir cada mes los cinco pares más cointegrados entre las 30 monedas más negociadas, con las muertas
        dentro, y operar el spread en 2 desviaciones: <strong>−0,77 % al mes</strong>, el 38 % de los meses en
        positivo y 41 de cada 100 operaciones cortadas por el stop. Cinco pares al azar con la misma regla
        pierden menos (−0,34 %): lo que parecía cointegrado en los últimos 180 días deja de serlo. Las nueve
        celdas vecinas son negativas.
      </>
    ),
  },
  {
    verdict: 'ojo',
    what: 'Volatilidad implícita (DVOL de Deribit) y prima de varianza',
    detail: (
      <>
        La opción se paga por encima de lo que luego se mueve el precio: en BTC, 60 puntos de DVOL frente a 51
        de volatilidad realizada (<strong>+9 puntos</strong>), y vender varianza ganó en el 76 % de los 67
        periodos de 30 días. Pero perdió 68 puntos de golpe a partir de enero de 2026, la prima se ha ido
        encogiendo (+22 en 2021, −5 en 2026) y en ETH ya no existe en la segunda mitad. El DVOL sí sabe algo que
        la volatilidad pasada no sabe, pero no anticipa la dirección. La app no lee opciones ni la cuenta las
        opera: es contexto, y la prima que enseñaría es la que ha dejado de pagar.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'Posicionamiento: open interest, ratios long/short y liquidaciones',
    detail: (
      <>
        Binance dejó de publicar las liquidaciones, así que el open interest en monedas hace de proxy. En BTC y
        ETH, el cambio del open interest, los takers y los cuartiles de precio contra OI no anticipan nada con
        |t| mayor de 1,5; y tras un hundimiento del open interest no hay rebote. En 30 perpetuos, el ratio de
        cuentas long frente a short sale contrario (<strong>−1 % por semana</strong>, t −3,9), pero tres
        cuartas partes son qué monedas tienen siempre más cuentas en long: frente a su propia media de 365 días queda
        en −0,3 % (t −0,8). Es otra vez identidad de moneda, no el momento.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'Comprar los «pumps» de 7 días en monedas poco negociadas',
    detail: (
      <>
        Un vídeo atribuye a eso el −48 % de un bot de IA. Medido en las 607 series de pares de Binance desde
        2018, con las 199 que dejaron de cotizar, repartidas por volumen en dólares: el quinto que más sube en
        7 días rinde <strong>+0,5 %, −0,2 % y +0,1 %</strong> a la semana sobre su banda (líquidas, medias,
        ilíquidas), y los que suben más de un 30 %, −0,1 %, −1,8 % y −0,7 %. Ninguna celda pasa el listón (t
        entre −1,4 y +1,4) y el signo cambia con la definición. No se demuestra que pierda ni que gane; lo
        que sí se ve es una cola derecha que seduce y un resultado típico por debajo de cero.
      </>
    ),
  },
  {
    verdict: 'ojo',
    what: 'La regla de tendencia en otros mercados (ETF, bonos, oro): solo largos',
    detail: (
      <>
        La misma regla de «Canal 20 + EMA 200», sin tocar nada, en velas diarias de <strong>41 ETF</strong>
        durante 25 años: los longs ganan <strong>+0,61 R</strong> por operación frente a +0,16 de una
        entrada larga al azar con el mismo stop, y los shorts no aportan nada (−0,16 frente a −0,13). Hace
        falta el filtro de la EMA 200: sin él queda en +0,03. Pero con límites: los últimos cinco años son
        más flojos (+0,32 R, con un intervalo que incluye el cero); como cuenta gana lo mismo que comprar
        SPY y mantenerlo (mismo Sharpe, 0,65 frente a 0,64) con un tercio menos de caída máxima y mucho
        apalancamiento; las cuatro materias primas de OKX por sí solas no bastan para afirmarlo; y las
        acciones que lista OKX no cuentan, porque son las que hoy están de moda. Lo que sí aporta es
        diversificar: sus resultados mensuales casi no se parecen a los de la tendencia en cripto
        (correlación −0,05). Los filtros de volumen y de BTC de las etiquetas no se repiten fuera de
        cripto. La app no lo vigila: la EMA 200 necesita 620 velas diarias y los contratos de acciones
        llevan menos de seis meses cotizando.
      </>
    ),
  },
  {
    verdict: 'ojo',
    what: 'Oro: cubrir el perpetuo XAU con oro tokenizado',
    detail: (
      <>
        El perpetuo del oro pagó a los cortos un <strong>+12 % anual</strong> de media en las últimas 13
        semanas (8 por encima del 10 %, 3 negativas), y existen <strong>PAXG-USDT</strong> y{' '}
        <strong>XAUT-USDT</strong> en spot para cubrirlo. Con la regla de la página de Financiación (dentro
        si la última semana pagó más del 10 %, fuera al llegar a cero) salieron <strong>+1,6 % netos</strong>{' '}
        con comisiones de mercado y +2,3 % con órdenes límite en 95 días, entre un 6 y un 9 % anual sobre
        una pata. Son solo tres meses, y hay riesgo de emisor y de base (el perpetuo cotiza entre −0,3 % y
        +0,5 % sobre PAXG). La página de Financiación hoy no lo ofrece porque busca un par «XAU-USDT» que no
        existe. El de la plata paga más (+28 %) pero no tiene cobertura en OKX, y el petróleo paga al
        revés. Y al contrario: operar la tendencia larga del oro con el perpetuo cuesta más de media R al
        mes en financiación.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'Comprar una caída fuerte (y venderla en corto)',
    detail: (
      <>
        Entre las 30 monedas más negociadas de Binance, con las que murieron incluidas, una moneda que cierra
        un día a −20 % o peor <strong>sigue cayendo</strong>: −5,9 % frente a su banda a 3 días y −10,5 % a 7,
        en los ocho años y también entre las que siguen cotizando. Comprar el rebote pierde. Venderla en
        corto no lo arregla: con un stop del 10 %, costes y financiación en contra queda en +1,3 % (muy poco
        fiable) y el stop salta en la mitad de los casos, porque tras un día así sube un 10 % tan a menudo
        como cae más. Sin stop da +5,4 %, pero es una lotería de apretones.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'Vender en corto las dos patas de un ETF apalancado (SOXL y SOXS)',
    detail: (
      <>
        Un fondo 3× pierde por composición mucho más de lo que parece, y vender los dos lados por igual
        sugiere cobrar ese desgaste. Pero el desgaste está en la mediana, no en la esperanza: lo que se cobra
        casi todos los meses se devuelve en unos pocos. En 19 pares y 227 meses sale <strong>+0,5 % al mes</strong>{' '}
        sobre el nominal antes de financiación, con un peor mes de <strong>−43,7 %</strong> (SOXL y SOXS), y
        −0,4 % al mes si el perpetuo cobra la financiación base (que en estos contratos es casi cero).
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'Bots de rejilla',
    detail: (
      <>
        Una rejilla larga de 30 celdas a ±15 % en 33 monedas, en ventanas de 30 días: <strong>−1,0 %</strong>{' '}
        por ventana de media, frente a −0,1 % para las mismas monedas con sus días barajados (lo que deja a una
        rejilla en menos sus comisiones). Gana el +4 % típico en un mes lateral y pierde de −8 % a −35 % cuando la
        moneda cae. Lo decide el mercado, no la rejilla: −7,8 % de media si BTC baja más de un 10 % en el mes,
        +3,0 % si sube. Muchos aciertos pequeños alrededor de un cero con cola.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'La tendencia de la relación alt/BTC (fuerza relativa)',
    detail: (
      <>
        Parecía el mejor resultado del proyecto (+0,62 R sobre 4.999 operaciones, y +1,29 R en 2018–2021) y era
        un espejismo de las velas con que se midió: una relación no tiene máximos ni mínimos reales y un stop
        que solo ve apertura y cierre no se toca nunca. Reconstruida con datos más finos baja a +0,28 R con
        extremos horarios y a +0,17 R con extremos de 15 minutos, con la segunda mitad en cero. Lección: una
        serie derivada hay que medirla con la resolución del stop real.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'RSI(2) al retroceso y el cambio de mes, en bolsa',
    detail: (
      <>
        En su mercado de origen el RSI(2) al retroceso (por encima de la media de 200 días, RSI de 2 por debajo
        de 10) sí gana algo, <strong>+0,33 % por operación</strong> en 20 ETF, pero decae (+0,51 % en 2000–2009,
        +0,17 % después) y la segunda mitad se queda por debajo del listón; en cripto no ganaba. El efecto del
        cambio de mes en SPY y QQQ desapareció: +0,5 % al mes en 1995–2004 y +0,0 % desde 2015.
      </>
    ),
  },
  {
    verdict: 'ojo',
    what: 'Filtrar las entradas de las estrategias de tendencia: volumen y régimen de BTC',
    detail: (
      <>
        Sobre el Donchian + EMA 200 y el cruce de la EMA 200 en 4 h (30 monedas, 2022–26 y 2018–21), con cinco
        filtros escritos antes de ver el número: 13 de 18 celdas van como se predijo. Dos tienen algo.{' '}
        <strong>Volumen de la vela de entrada ≥ 1,5× la media</strong>: +0,51 R frente a +0,09 en el Donchian y
        +0,37 frente a +0,09 en el cruce, también sin fines de semana y contra la misma franja horaria; en 1 h y
        en el diario sin supervivencia el signo es el mismo y casi no se distingue de cero.{' '}
        <strong>Longs con BTC por encima de su EMA 200 de 4 h</strong>: +0,74 R frente a +0,13 (Donchian), +0,46
        frente a −0,02 en 1 h, +0,53 frente a −0,13 en el diario con monedas muertas: siete de siete, y los shorts
        no ganan en ningún régimen. En 1 h, además, las entradas que cierran en fin de semana pierden (−0,13 R
        frente a +0,21). Funcionan como <em>prioridad</em>, no como ventaja nueva: lo que descartan todavía gana
        algo en 4 h, así que baja el total y sube la media. Fines de semana en 4 h, entrada «extendida» y
        financiación abarrotada no aportan. Todo son la misma familia de tendencia y el régimen se encontró
        mirando los controles: se muestra como etiquetas de contexto en las tarjetas de «Qué vigilar», con las
        cifras en su tooltip, y la sección Seguimiento lo pone a prueba con operaciones que entonces no existían.
      </>
    ),
  },
  {
    verdict: 'ojo',
    what: 'Leer el seguimiento en vivo por la media de lo ya cerrado',
    detail: (
      <>
        Un seguidor de tendencia corta rápido las perdedoras y deja correr las ganadoras, así que en un registro
        joven <strong>lo cerrado son casi todo pérdidas</strong> (en una prueba sobre cuatro días del histórico,
        −1,0 R de media con +0,2 a +0,4 R medidos): la media de las cerradas daría una falsa alarma cada vez. Por
        eso cada señal se compara con lo que valían las del histórico <strong>a su misma edad</strong>, abiertas
        incluidas. Y la banda de esa comparación no es la de operaciones independientes: las señales que saltan el
        mismo día en veinte contratos comparten mercado, y repitiendo la cuenta sobre el propio histórico el azar
        movía la diferencia <strong>entre 2,1 y 2,4 veces</strong> más de lo que diría la independencia (1,1 en la
        reversión, que salta una vez por semana). Con esa amplitud, distinguir de cero una media de +0,36 R
        necesita unas <strong>3 100 operaciones cerradas</strong> en la ruptura de 4 h —cuatro años y medio al
        ritmo de 20 contratos—, 6 200 en el cruce y unas 109 en la reversión. El seguimiento sirve para ver si
        algo se desvía con claridad y para ir acumulando, no para decidir pronto.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'Flechas de compra y venta con Klinger y «más del 90 % de acierto»',
    detail: (
      <>
        Los vídeos de «imposible perder» enseñan cuatro operaciones elegidas a posteriori con un indicador de
        flechas. La parte medible (el oscilador de Klinger, un stop en el último extremo y un objetivo de 1,5
        veces el riesgo, en 5 minutos sobre dos años de BTC y ETH) acierta el <strong>43 %</strong> y gana
        +0,01 R antes de comisiones: lo mismo que mirar solo el color de la vela. Con ese objetivo, un precio
        sin deriva lo alcanza el 40 % de las veces; un 90 % exigiría +1,25 R por operación, cinco veces más
        que lo mejor que existe aquí. Lo que fabrica esas demostraciones es una flecha que se repinta.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'Toma de liquidez + IFVG en la apertura de Nueva York (Smart Money)',
    detail: (
      <>
        Es la receta de moda: esperar a que el precio barra un máximo o un mínimo, buscar un hueco de valor
        razonable que se invalida y entrar en el cierre que lo invierte, en los primeros 90 minutos de la
        apertura. Medida tal como se cuenta, en 1 minuto sobre dos años de BTC y ETH (503 operaciones):{' '}
        <strong>−0,04 R</strong> antes de comisiones y <strong>−0,37 R</strong> netos; incluso ejecutando
        todo como maker quedan −0,12 R. La toma de liquidez sola y el hueco invertido dan lo mismo antes de
        costes: el IFVG solo retrasa la entrada, así que el stop queda más lejos y la comisión pesa menos.
        Lo más cercano a algo es la sesión asiática (+0,11 R bruto), y tampoco compensa el coste.
      </>
    ),
  },
  {
    verdict: 'no',
    what: 'RSI en sobrecompra o sobreventa + soporte o resistencia + vela de giro',
    detail: (
      <>
        Es la receta habitual para «arreglar» el RSI: pedirle además un nivel y una vela de giro. Medida tal
        como se cuenta, en 1 h sobre 31 monedas desde 2022 (2.065 operaciones, objetivo 2 R):{' '}
        <strong>−0,18 R</strong> por operación, con las dos mitades iguales. Y lo revelador es la
        descomposición: la vela de giro sola, sin RSI ni nivel, da −0,03 R; cada condición que se le añade la
        deja igual o peor, y la peor es el propio RSI. Un RSI extremo en un giro suele ser una continuación.
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
        resto la semana siguiente. Poco, pero consistente: úsalo para no entrar en long.
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
            marcha, cualquier aviso de riesgo y las <em>oportunidades ahora</em>: BTC, ETH y SOL cuando la
            Reversión tiene en ellos una señal viva que todavía merece la pena. Si solo miras una sección, que sea
            esta.
          </li>
          <li>
            <strong>En curso</strong>: lo que tienes abierto ahora (posiciones, bots, órdenes
            pendientes) con su riesgo: distancia a la liquidación, si tiene stop, cuánto le queda a cada
            bot.
          </li>
          <li>
            <strong>Bots</strong>: cada bot en marcha con su rango y dónde está el precio dentro de él, lo
            que ha ganado la rejilla frente a lo que se han llevado las comisiones, la posición que acumula
            y lo lejos que está de la liquidación.
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
            <strong>Estrategias</strong>: las estrategias que se han medido con años de datos, con su señal
            actual y su historial. Solo se ofrecen en las temporalidades donde ganan en las dos mitades del
            histórico, y las cifras se vuelven a medir cada mes: la Apertura se retiró en octubre de 2026. Debajo del
            gráfico, aquí y en Análisis, <em>Tamaño de la operación</em> calcula cuántos contratos abrir para
            arriesgar lo que elijas si salta el stop, y si tu margen libre lo aguanta.
          </li>
          <li>
            <strong>Seguimiento</strong>: cada señal nueva de las estrategias medidas, apuntada por el servidor
            antes de conocer su resultado y resuelta con las velas siguientes, comparada con lo que valían las del
            histórico a su misma edad. Es la única evidencia que no pudo escogerse mirando cómo acabó; es lenta, y la
            página hace la cuenta de cuánto. Con un canal configurado (ntfy o Telegram) avisa de cada señal nueva
            de 4 h o diaria al móvil, y el botón <em>Probar aviso</em> manda un mensaje de prueba para comprobar que
            llega sin esperar a una señal.
          </li>
        </ul>
        <p className="sub">
          Los «?» junto a cada cifra explican qué es y qué hacer con ella. Todos están también en el
          glosario, al final de esta página.
        </p>
        <h3>Con Claude</h3>
        <p>
          El botón <strong>Claude</strong> de la barra de arriba copia la cuenta como texto (avisos, posiciones,
          rendimiento, cartera y, si quieres, las señales y la financiación) para pegarla en un chat de
          claude.ai. Lleva las reglas de esta app: Claude explica las cifras, no las recalcula, y no propone
          entradas que no salgan de las estrategias medidas. El mismo botón explica cómo crear un proyecto
          para no repetir las instrucciones, y cómo activar el conector, con el que Claude lee la cuenta
          por sí mismo sin copiar nada. El conector tiene también una herramienta de seguimiento, que le da el
          registro en vivo con las mismas cautelas que la página.
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
            <strong>Oportunidades ahora</strong>, en el Resumen: las señales vivas de la Reversión en BTC,
            ETH y SOL, las únicas monedas donde está medida, ordenadas por el recorrido que les queda. Ábrelas en Estrategias para ver el gráfico, y decide
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
            Alcista, piensa en longs; bajista, en shorts. Mírala en 4 h o en diario.
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
            <strong>Toques a la EMA 25 diaria</strong> (la primera tarjeta): pulsa «Buscar toques» y mira cuáles de
            los 20 X-Perp con más volumen han tocado su EMA 25 en las últimas 3 velas diarias —hoy, ayer y
            anteayer—, con el día de cada toque, por qué lado venía el precio (desde arriba o desde abajo) y
            cuántos días llevaba sin tocarla. Con una segunda búsqueda con los mismos ajustes marca los{' '}
            <em>nuevos</em> y los que <em>ya no tocan</em> (se recuerda solo en este navegador). Es contexto, no
            una señal: el «?» de la tarjeta dice qué se midió. También sale en «Copiar para Claude» y en la
            herramienta de señales del conector.
          </li>
          <li>
            <strong>Qué vigilo</strong> (las dos tarjetas siguientes): una por cada estrategia de
            tendencia que pasó el listón en 4 h —la ruptura de 20 velas a favor de la EMA 200 y el cruce de
            la EMA 200—. Escanean los 10 o 20 contratos más negociados y dicen cuáles tienen la señal nueva,
            la están rompiendo ahora o están cerca. Entrar con una tendencia ya empezada no está medido.
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
