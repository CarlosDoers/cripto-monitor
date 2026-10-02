import type { ReactNode } from 'react'
import { ratio, share } from './format'

/**
 * What each figure means, in one place.
 *
 * The same term appears on several views — the hit rate on Resumen,
 * Rendimiento and Señales — and an explanation written three times drifts into
 * three explanations. Views import from here and never write their own.
 *
 * Written for someone who trades but does not live in the jargon: say what the
 * number is, then what to do with it, and give an example when the definition
 * alone would not land.
 */

export const HELP = {
  // ---- Resumen, Cartera ----
  netWorth: (
    <p>
      Todo lo que vale tu cuenta de OKX ahora mismo, a precio actual: trading, fondos, Earn y lo
      que tienen los bots. Es la misma cifra que muestra OKX.
    </p>
  ),
  unrealisedPnl: (
    <p>
      Lo que ganarías o perderías si cerraras ahora las posiciones abiertas. Todavía no está en
      tu saldo y cambia con cada movimiento del precio.
    </p>
  ),
  realisedToday: (
    <p>
      Resultado de las posiciones que has cerrado hoy (desde las 00:00 de tu hora), ya con comisiones y
      financiación. Lo que sigue abierto está en la ganancia abierta.
    </p>
  ),
  realisedPnl30: (
    <p>
      Resultado de las posiciones de derivados que <strong>cerraste</strong> en los últimos 30
      días, ya descontadas comisiones y financiación. Es dinero que ya ha entrado o salido de tu
      saldo.
    </p>
  ),
  winRate: (
    <>
      <p>Porcentaje de operaciones cerradas con ganancia.</p>
      <p>
        Por sí solo no dice si ganas dinero: puedes acertar el 70 % y perder si las pérdidas son
        mucho mayores que las ganancias. Míralo junto al riesgo/recompensa.
      </p>
    </>
  ),
  profitFactor: (
    <>
      <p>
        Todo lo ganado en las operaciones ganadoras dividido entre todo lo perdido en las
        perdedoras.
      </p>
      <p>
        Por encima de 1 ganas dinero. Un 2 significa que por cada dólar perdido has ganado dos.
      </p>
    </>
  ),
  bots: (
    <p>
      Capital de tus bots más su resultado actual. Ya está incluido en el patrimonio total, así
      que no hay que sumarlo.
    </p>
  ),
  marginRatio: (
    <>
      <p>
        Cuánto margen tienes frente al mínimo que OKX exige para mantener abiertas tus posiciones.
      </p>
      <p>
        Cuanto más alto, más lejos estás de la liquidación. Si baja al <strong>100 %</strong>,
        OKX cierra la posición.
      </p>
    </>
  ),
  freeMargin: (
    <p>
      Dinero que no está bloqueado en posiciones ni en bots. Es lo que podrías usar para reforzar
      una posición que va en contra; si está a cero, ante un movimiento adverso sólo queda cerrar o
      ser liquidado.
    </p>
  ),
  notional: (
    <p>
      Valor total de lo que controlan tus posiciones (tamaño × precio), no el dinero que has
      puesto. Con apalancamiento 10×, 100 US$ de margen mueven 1 000 US$ de nocional.
    </p>
  ),
  tightestBot: (
    <p>
      El bot DCA que más órdenes de seguridad ha gastado. Son las compras extra con las que
      promedia cuando el precio va en contra; cuando se acaban ya no puede defenderse, y el
      siguiente movimiento en contra lo acerca a la liquidación.
    </p>
  ),
  expectancy: (
    <p>
      Lo que ganas o pierdes de media en cada operación cerrada, ya con costes. Si es positivo, tu
      forma de operar gana dinero a la larga aunque falles muchas veces.
    </p>
  ),

  // ---- Rendimiento ----
  drawdown: (
    <>
      <p>
        Cuánto bajó tu resultado acumulado desde su máximo anterior hasta el punto más bajo, antes de
        volver a subir. Es lo que tu cuenta tiene que aguantar sin que cambies de plan.
      </p>
      <p>
        Se mide sobre lo realizado, en dólares: los depósitos que llegaron por el camino harían saltar
        un porcentaje cada vez que entra dinero.
      </p>
    </>
  ),
  monteCarlo: (
    <>
      <p>
        Se toman tus operaciones del periodo y se reordenan al azar miles de veces, repitiendo unas y
        saltando otras, para ver qué caídas y qué rachas produce tu forma de operar solo por suerte.
      </p>
      <p>
        Si tu caída real es peor que casi todas las simuladas, algo cambió: el mercado o tu forma de
        operar. Supone que cada operación es independiente y que el futuro se parece al pasado; es una
        descripción de lo ocurrido, no una promesa.
      </p>
    </>
  ),
  totalCosts: (
    <p>
      Comisiones de compra y venta más la financiación de los perpetuos. Si la financiación que
      cobras supera a las comisiones, sale positivo.
    </p>
  ),
  duration: <p>Tiempo medio entre que abres una posición y la cierras.</p>,
  roi: (
    <p>
      Resultado de la operación dividido entre el margen que pusiste, no entre su tamaño. Con
      apalancamiento 5× un movimiento del 2 % en el precio es un ROI del 10 %, en las dos
      direcciones.
    </p>
  ),
  streak: (
    <p>
      Operaciones seguidas con el mismo resultado. Una racha larga de pérdidas es normal incluso
      en una estrategia rentable; sirve para saber cuánto aguante hace falta.
    </p>
  ),

  // ---- Posiciones ----
  realisedOpen: (
    <p>
      Lo ya realizado dentro de las posiciones que siguen abiertas: cierres parciales, comisiones
      pagadas y financiación. No incluye posiciones ya cerradas.
    </p>
  ),
  funding: (
    <>
      <p>
        Pago cada 8 horas entre largos y cortos de un perpetuo, para que su precio no se separe
        del precio spot.
      </p>
      <p>Según hacia dónde se incline el mercado, lo pagas o lo cobras.</p>
    </>
  ),
  markPrice: (
    <p>
      Precio que OKX usa para calcular tu PnL y la liquidación. Sale del índice spot y no de la
      última operación, para que un pico puntual no te liquide.
    </p>
  ),
  liqPrice: (
    <p>
      Si el precio de marca llega aquí, OKX cierra la posición a la fuerza y pierdes el margen
      que tenía.
    </p>
  ),
  liqDistance: (
    <p>
      Cuánto tendría que moverse el precio en tu contra, en %, para llegar a la liquidación.
      Cuanto más pequeño, más peligro.
    </p>
  ),
  protection: (
    <p>
      Si la posición tiene un stop-loss o un take-profit puesto en OKX. Sin stop, nada la cierra
      antes de la liquidación.
    </p>
  ),
  marginUsed: <p>Dinero tuyo bloqueado como garantía de esta posición.</p>,

  // ---- Bots ----
  botPnl: (
    <p>
      Resultado de todos los bots en marcha, lo cerrado y lo abierto, ya con financiación
      descontada.
    </p>
  ),
  committed: (
    <p>
      Capital que has asignado a los bots. Un DCA no lo usa todo al principio: guarda una parte
      para las órdenes de seguridad, así que comprometido no significa invertido.
    </p>
  ),
  fuelUsed: (
    <p>
      Qué parte de sus órdenes de seguridad ha gastado el bot más apurado. Al 100 % ya no puede
      promediar más, y un movimiento en contra va directo hacia la liquidación.
    </p>
  ),
  botTarget: (
    <p>El precio al que el bot cierra el ciclo con beneficio (take-profit) y vuelve a empezar.</p>
  ),

  // ---- Señales ----
  signalsDetected: (
    <p>
      Veces que la estrategia habría dado entrada en el histórico de velas cargado. Es una prueba
      sobre el pasado, no operaciones reales.
    </p>
  ),
  signalWinRate: (
    <p>
      Porcentaje de señales que llegaron al objetivo antes que al stop. Estas estrategias aciertan
      poco a propósito: ganan porque lo que ganan es varias veces lo que pierden.
    </p>
  ),
  r: (
    <>
      <p>
        <strong>R</strong> es lo que arriesgas en una operación: la distancia entre la entrada y el
        stop.
      </p>
      <p>
        Ganar 2 R es ganar el doble de lo arriesgado; perder 1 R es que saltó el stop. Medir en R
        permite comparar operaciones de cualquier tamaño.
      </p>
    </>
  ),
  expectancyR: (
    <>
      <p>
        Lo que gana o pierde de media cada señal, en R, ya restada la comisión. Es la cifra que
        decide si la estrategia gana dinero.
      </p>
      <p>
        Por encima de 0 gana a la larga. Aquí sólo se ofrecen las que superan 0,1 R, para dejar
        margen a los deslizamientos.
      </p>
    </>
  ),

  // ---- Mercados ----
  tradability: (
    <p>
      Nota de 0 a 100 de lo fácil y barato que es operar el contrato ahora: liquidez (35 %),
      coste de la horquilla (35 %) y cuánto se mueve (30 %). No predice hacia dónde irá el precio.
    </p>
  ),
  opportunities: (
    <>
      <p>
        Los X-Perp de cripto con más de 1 M$ al día donde la Reversión diaria, la estrategia más
        sólida que se ha medido, tiene ahora una señal viva: disparó en los últimos 7 días y el precio
        aún no ha tocado ni su stop ni su objetivo.
      </p>
      <p>
        Entrar tarde se ha medido: con el mismo stop y objetivo de la señal, hacerlo entre 1 y 7 días
        después sigue siendo rentable en todas las edades y en las dos mitades del histórico. Se
        ordenan por la recompensa que queda por cada unidad de riesgo al precio de ahora: cuanto más
        recorrido le queda, mejor ha salido de media, y con menos de 1:1 es donde menos se gana.
      </p>
      <p>
        Medido en BTC, ETH y SOL; en otras monedas es la misma regla sin la misma evidencia. Ninguna
        señal es segura: aproximadamente la mitad acaban en el stop. Lo que la hace rentable es que
        las que ganan pagan más de lo que cuestan las que pierden.
      </p>
    </>
  ),
  screenerStructure: (
    <>
      <p>
        El Screener solo tiene unas 200 velas diarias por contrato: los X-Perp cotizan desde marzo
        de 2026, así que no hay más. Con tan poca historia, la estructura principal (giros de 50
        velas) a menudo aún no existe, y entonces se muestra la interna, indicándolo.
      </p>
      <p>
        Medido sobre BTC, ETH y SOL, que sí tienen años de historia: con 200 velas la dirección
        principal coincide con la que da una historia cinco veces más larga en el 59 % de los casos,
        falta en el 36 % y apunta al lado contrario en el 5 %. La estructura interna coincide
        siempre. Si vas a decidir por la principal, mírala en Análisis en 4 h: con el mismo medio año
        de vida hay seis veces más velas.
      </p>
    </>
  ),
  smc: (
    <>
      <p>
        Lectura de la estructura del mercado, adaptada del indicador Smart Money Concepts de
        LuxAlgo. <strong>BOS</strong> (ruptura de estructura): el precio cierra más allá del último
        giro en la dirección de la tendencia. <strong>CHoCH</strong> (cambio de carácter): lo hace en
        contra, y la tendencia cambia.
      </p>
      <p>
        La estructura <strong>principal</strong> usa giros de 50 velas; la <strong>interna</strong>,
        de 5. Un <strong>OB</strong> (order block) es la vela desde la que salió el movimiento que
        rompió la estructura; un <strong>FVG</strong>, un hueco que tres velas dejaron sin cotizar.
        Premium y descuento dicen si el precio está en la mitad alta o baja del último rango.
      </p>
      <p>
        Un OB en gris es uno al que el precio ya ha vuelto: el que sigue en color, sin tocar, es el
        que los traders de SMC esperan. Pero volver es lo normal: entre el 83 y el 94 % de los OB se
        tocan tarde o temprano. Medido como señal sobre años de datos: volver al order block pierde
        en todas las temporalidades (también con las reglas de la versión «Enhanced»), y entrar en las rupturas internas en 4 h gana (+0,20 R), pero coincide en la
        mitad de sus operaciones con la estrategia Ruptura, que gana más. Aquí sirve para leer la
        estructura, no como señal de entrada.
      </p>
    </>
  ),
  screener: (
    <>
      <p>
        Cada atajo filtra el tablero; ninguno es una recomendación. Medido sobre 30 criptos del
        tablero y 248 semanas desde 2022, comparando lo que cada atajo seleccionaba con el resto de
        contratos esa misma semana:
      </p>
      <p>
        <strong>Sobrecompra</strong> y <strong>volumen inusual</strong> ganan de media, pero por unas
        pocas subidas enormes: el contrato típico se queda por detrás del resto.{' '}
        <strong>Sobreventa</strong> no anticipa ningún rebote. Lo único que se sostiene en todos los
        cortes es que, tras un <strong>CHoCH bajista</strong>, el contrato va de media un 1 % peor que
        el resto la semana siguiente: poco, y es una de nueve pruebas.
      </p>
    </>
  ),
  rsi: (
    <p>
      Índice de fuerza relativa de 14 días, de 0 a 100. Por encima de 70 se suele llamar
      sobrecompra y por debajo de 30 sobreventa. Describe cuánto ha subido o bajado seguido, no
      cuándo se va a dar la vuelta: en tendencia puede pasar semanas por encima de 70.
    </p>
  ),
  volatility: (
    <p>
      Rango medio diario (máximo menos mínimo, sobre el cierre) de los últimos 30 días. Un 5 %
      significa que un día normal recorre un 5 % de punta a punta: con él se dimensiona un stop.
    </p>
  ),
  relVolume: (
    <p>
      Volumen de las últimas 24 horas dividido entre la media diaria de los 20 días anteriores. 2×
      es el doble de lo habitual: algo ha atraído dinero, sin decir en qué dirección.
    </p>
  ),
  breadth: (
    <p>
      Cuántos contratos suben y cuántos bajan en 24 h. Si BTC sube pero la mayoría baja, la subida
      es de unos pocos; si casi todo se mueve junto, es el mercado entero el que va en esa
      dirección.
    </p>
  ),
  spread: (
    <p>
      Diferencia entre el mejor precio de compra y el de venta, en puntos básicos (1 pb = 0,01 %).
      Es lo que pierdes al entrar y salir al instante: cuanto más baja, mejor.
    </p>
  ),
  basis: (
    <p>
      Diferencia entre el precio del contrato y el precio spot. Positiva: el contrato está más caro
      que el spot, y al acercarse los dos un largo pierde esa diferencia y un corto la gana.
    </p>
  ),
  openInterest: (
    <p>
      Valor de todos los contratos abiertos ahora mismo por todos los traders. Más posición
      abierta es más dinero en juego y, normalmente, un mercado más profundo.
    </p>
  ),
  range24h: (
    <p>Distancia entre el máximo y el mínimo de las últimas 24 horas, en % del precio.</p>
  ),
  maxLeverage: <p>Apalancamiento máximo que OKX permite en este contrato.</p>,

  // ---- Historial ----
  deposits: (
    <p>
      Todo lo que has ingresado, en monedas o por banco, valorado al precio del día en que llegó.
      Así lo que esas monedas hayan subido después cuenta como ganancia y no como dinero tuyo.
    </p>
  ),
  netContribution: <p>Lo que has ingresado menos lo que has retirado: el dinero que es tuyo.</p>,
  totalResult: (
    <>
      <p>
        Patrimonio actual menos lo aportado: <strong>todo lo que has ganado</strong> desde que
        empezaste.
      </p>
      <p>
        Incluye el trading, los bots y lo que han subido o bajado las monedas que tienes.
      </p>
    </>
  ),
  tradingResult: (
    <p>
      Sólo las posiciones de derivados cerradas, ya con costes. Es una parte del resultado total,
      no algo que se le sume.
    </p>
  ),

  // ---- Spot ----
  spotResult: (
    <p>
      Ganancia de las monedas que compraste y vendiste dentro de OKX, emparejando cada venta con
      las compras más antiguas. Ya descuenta comisiones.
    </p>
  ),
  uncovered: (
    <p>
      Ventas de monedas que llegaron por depósito. Se compraron fuera de OKX, así que no hay precio
      de compra con el que calcular si ganaste o perdiste, y se dejan fuera del resultado.
    </p>
  ),
  coverage: (
    <p>
      Qué parte de lo vendido tiene precio de compra conocido. Con una cobertura baja, el
      resultado en spot sólo cuenta una parte de la historia.
    </p>
  ),

  // ---- Financiación ----
  carry: (
    <>
      <p>
        Tener una moneda y abrir a la vez un <strong>corto del mismo tamaño</strong> en su perpetuo. Si
        el precio sube, lo que ganas en la moneda lo pierdes en el corto, y al revés: el precio deja de
        importar.
      </p>
      <p>
        Lo que queda es la financiación: cuando es positiva, los largos pagan a los cortos cada 8 horas, y
        tú cobras.
      </p>
    </>
  ),
  fundingTrailing: (
    <p>
      Lo que pagó la financiación del contrato en los últimos 7 días, llevado a un año. Es la cifra en la
      que se apoya la regla: cubrir cuando pasa del 10 % y deshacer cuando baja de cero.
    </p>
  ),
  fundingNow: (
    <p>
      El tipo del periodo que está corriendo ahora, llevado a un año. Cambia cada pocos minutos y un pico
      de un día no dice nada; por eso la regla mira los últimos 7 días.
    </p>
  ),
  carryBreakEven: (
    <p>
      Cuántos días de financiación, al ritmo de la última semana, hacen falta para pagar las comisiones de
      montar y deshacer la cobertura. Si la financiación se gira antes, la operación pierde.
    </p>
  ),
  carryContracts: (
    <p>
      Contratos en corto que igualan lo que tienes de la moneda, redondeados hacia abajo. Con menos quedas
      cubierto solo en parte; con más, apuestas a que baja.
    </p>
  ),
} satisfies Record<string, ReactNode>

/**
 * The risk/reward, with the figure that makes it usable: the hit rate at which
 * that ratio stops losing money. "1:2,11" means little on its own; "you only
 * need to be right 32 % of the time" is what it is for.
 */
export function riskRewardHelp(rr: number): ReactNode {
  const breakEven = rr > 0 ? 1 / (1 + rr) : undefined
  return (
    <>
      <p>
        Cuánto ganas de media en una operación ganadora por cada unidad que pierdes de media en una
        perdedora.
      </p>
      {breakEven !== undefined ? (
        <p>
          <strong>1:{ratio(rr)}</strong> significa que cuando fallas pierdes 1 US$ de media y cuando
          aciertas ganas {ratio(rr)} US$. Con esa proporción te basta acertar más del{' '}
          <strong>{share(breakEven, 0)}</strong> de las veces para no perder dinero.
        </p>
      ) : (
        <p>1:2 significa que tus ganancias medias son el doble que tus pérdidas medias.</p>
      )}
    </>
  )
}
