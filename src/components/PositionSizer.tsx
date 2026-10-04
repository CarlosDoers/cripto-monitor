import { useEffect, useMemo, useState } from 'react'
import { plural, price, qty, ratio, share, usd } from '../lib/format'
import { HELP } from '../lib/glossary'
import { usePortfolio } from '../lib/portfolio'
import { instTypeOf } from '../lib/instruments'
import { useInstruments, useTickers, useTradeFee } from '../lib/queries'
import { parseTyped, sizePosition } from '../lib/sizing'
import type { StrategySignal } from '../lib/indicators/types'
import { Card, Help } from './ui'

const RISKS = [0.0025, 0.005, 0.01, 0.02] as const

const parse = parseTyped

/** A level as it would be typed here: six significant digits, decimal comma, no float noise. */
const typed = (x: number) => String(Number(x.toPrecision(6))).replace('.', ',')

/**
 * "¿Cuántos contratos?": the risk you choose, the stop, the contract's value,
 * and what it ties up — next to the free margin that has to carry it. Filled
 * from the strategy's open signal when there is one; every field can be typed.
 */
export function PositionSizer({ instId, signal }: { instId: string; signal?: StrategySignal | null }) {
  const type = instTypeOf(instId)
  const instruments = useInstruments(type)
  const tickers = useTickers(type)
  const fee = useTradeFee(type === 'SPOT' ? 'SPOT' : type)
  const portfolio = usePortfolio()

  const inst = instruments.data?.find((i) => i.instId === instId)
  const live = Number(tickers.data?.find((t) => t.instId === instId)?.last) || 0

  const [riskShare, setRiskShare] = useState<number>(0.01)
  const [leverage, setLeverage] = useState('3')
  const [entry, setEntry] = useState('')
  const [stop, setStop] = useState('')

  // A new instrument or a new signal starts from its own levels. Keyed on the
  // stop, not the signal object: that is rebuilt on every refetch and would
  // wipe what the user typed every 30 seconds.
  const signalStop = signal?.stop
  useEffect(() => {
    setEntry('')
    setStop(signalStop !== undefined ? typed(signalStop) : '')
  }, [instId, signalStop])

  const entryPx = entry ? parse(entry) : live
  const stopPx = parse(stop)
  // OKX signs fees from the account's side: negative is charged. Taker both ways.
  const taker = -Number(fee.data?.[0]?.taker) || (type === 'SPOT' ? 0.002 : 0.0005)

  const sizing = useMemo(
    () =>
      sizePosition({
        equity: portfolio.netWorth,
        riskShare,
        entry: entryPx,
        stop: stopPx,
        ctVal: type === 'SPOT' ? 1 : Number(inst?.ctVal) * (Number(inst?.ctMult) || 1),
        ctType: type === 'SPOT' ? 'spot' : inst?.ctType === 'inverse' ? 'inverse' : 'linear',
        lotSz: Number(inst?.lotSz) || 1,
        minSz: Number(inst?.minSz) || 1,
        leverage: parse(leverage) || 1,
        freeMargin: portfolio.freeMargin,
        feeRate: 2 * taker,
      }),
    [portfolio.netWorth, portfolio.freeMargin, riskShare, entryPx, stopPx, type, inst, leverage, taker],
  )

  const unit = type === 'SPOT' ? instId.split('-')[0] : 'contratos'
  // The signal's side and the side its stop implies at today's price disagree
  // once price has gone through the stop. Only while the stop is still the
  // signal's: a stop the user typed is their own trade, either side.
  const usingSignalStop = signal !== null && signal !== undefined && Math.abs(stopPx / signal.stop - 1) < 1e-4
  const crossed = usingSignalStop && sizing && sizing.side !== signal.side

  return (
    <Card
      title="Tamaño de la operación"
      subtitle={
        signal
          ? 'Con el stop de la señal abierta y el precio de ahora. Cambia cualquier dato para tu propia operación'
          : 'Escribe el stop de tu operación: te dice cuántos contratos abrir para arriesgar lo que eliges'
      }
      action={<Help label="Tamaño de la operación">{HELP.positionSize}</Help>}
    >
      <div className="sizer">
        <div className="sizer-inputs">
          <div className="field">
            <label id="sizer-risk">Riesgo por operación</label>
            <div className="seg-control" role="group" aria-labelledby="sizer-risk">
              {RISKS.map((r) => (
                <button key={r} type="button" aria-pressed={riskShare === r} onClick={() => setRiskShare(r)}>
                  {share(r, r < 0.01 ? 2 : 0)}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="sizer-entry">Entrada</label>
            <input
              id="sizer-entry"
              inputMode="decimal"
              placeholder={live ? `${price(live)} (ahora)` : '—'}
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="sizer-stop">Stop</label>
            <input
              id="sizer-stop"
              inputMode="decimal"
              placeholder="precio del stop"
              value={stop}
              onChange={(e) => setStop(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="sizer-lever">Apalancamiento</label>
            <input id="sizer-lever" inputMode="decimal" value={leverage} onChange={(e) => setLeverage(e.target.value)} />
          </div>
        </div>

        {!sizing ? (
          <p className="sub">
            {portfolio.isLoading || instruments.isLoading ? 'Cargando…' : 'Falta un stop distinto de la entrada.'}
          </p>
        ) : (
          <>
            <ul className="sizer-result">
              <li>
                <span>Abrir</span>
                <strong>
                  {qty(sizing.size)} {unit}
                </strong>
                <span className="sub">{sizing.side === 'long' ? 'en largo' : 'en corto'}</span>
              </li>
              <li>
                <span>Si salta el stop pierdes</span>
                <strong>{usd(sizing.riskUsd)}</strong>
                <span className="sub">{share(sizing.riskUsd / portfolio.netWorth, 2)} del patrimonio</span>
              </li>
              <li>
                <span>Tamaño (nocional)</span>
                <strong>{usd(sizing.notionalUsd)}</strong>
                <span className="sub">{ratio(sizing.exposure, 2)}× el patrimonio</span>
              </li>
              <li>
                <span>Margen que bloquea</span>
                <strong>{usd(sizing.margin)}</strong>
                <span className="sub">libre ahora: {usd(portfolio.freeMargin)}</span>
              </li>
              <li>
                <span>Comisión ida y vuelta</span>
                <strong>{ratio(sizing.feeR, 2)} R</strong>
                <span className="sub">a {share(taker, 3)} por lado</span>
              </li>
            </ul>
            <div className="sizer-notes">
              {crossed && (
                <p className="sizer-warn">
                  El precio ya ha pasado el stop de la señal: esa operación está cerrada, no se puede entrar en ella.
                </p>
              )}
              {sizing.tooSmall && (
                <p className="sizer-warn">Con este riesgo no llega ni a {plural(Number(inst?.minSz) || 1, 'contrato', 'contratos')}: el stop está demasiado lejos para lo que quieres arriesgar.</p>
              )}
              {sizing.marginShort && !sizing.tooSmall && (
                <p className="sizer-warn">
                  Tu margen libre ({usd(portfolio.freeMargin)}) no alcanza para {usd(sizing.margin)}: tendrías que subir el
                  apalancamiento, reducir otra posición o no abrirla.
                </p>
              )}
              {sizing.feeR > 0.3 && (
                <p className="sizer-warn">
                  La comisión ya se lleva {ratio(sizing.feeR, 2)} R: con el stop tan cerca, la operación empieza perdiendo
                  una parte grande de lo que arriesga.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  )
}
