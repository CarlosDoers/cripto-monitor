import { useSyncExternalStore } from 'react'

/**
 * Display currency.
 *
 * The account settles in USDC, so every figure the API returns is in dollars.
 * OKX's own app converts them for display — if your OKX is set to euros, the
 * numbers here will not match it until this is set to euros too.
 *
 * The rate is read from OKX's own USDC-EUR ticker rather than hardcoded, so the
 * two apps agree instead of drifting apart.
 */

export type Currency = 'USD' | 'EUR'

const KEY = 'cripto-monitor:currency'

interface State {
  currency: Currency
  /** How many display units one USD is worth. 1 for USD. */
  rate: number
}

let state: State = { currency: readStored(), rate: 1 }
const listeners = new Set<() => void>()

function readStored(): Currency {
  try {
    return localStorage.getItem(KEY) === 'EUR' ? 'EUR' : 'USD'
  } catch {
    return 'USD'
  }
}

function emit() {
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setCurrency(currency: Currency) {
  if (state.currency === currency) return
  state = { ...state, currency }
  try {
    localStorage.setItem(KEY, currency)
  } catch {
    // Not worth failing a render over.
  }
  emit()
}

/** Called by the data layer once the USDC-EUR ticker is known. */
export function setUsdToEur(rate: number) {
  if (!Number.isFinite(rate) || rate <= 0) return
  if (usdToEur === rate) return
  usdToEur = rate
  if (state.currency === 'EUR') {
    state = { ...state, rate }
    emit()
  }
}

let usdToEur = 0

export function useCurrency() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  )
}

/** Converts a USD amount into the active display currency. */
export function convert(usd: number): number {
  return state.currency === 'EUR' && usdToEur > 0 ? usd * usdToEur : usd
}

export function activeCurrency(): Currency {
  // Fall back to dollars until the rate arrives, rather than showing euro
  // symbols on dollar amounts.
  return state.currency === 'EUR' && usdToEur > 0 ? 'EUR' : 'USD'
}

/** True when euros are selected but the rate has not loaded yet. */
export function isRatePending(): boolean {
  return state.currency === 'EUR' && usdToEur <= 0
}
