/** OKX sends numbers as strings, and "" for fields that don't apply. */
export function num(value: string | number | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const usdFormatter = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function usd(value: number): string {
  return usdFormatter.format(value)
}

/** Drops the cents once the number is big enough that they are noise. */
export function usdCompact(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 100_000) {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value)
  }
  return usd(value)
}

/**
 * Crypto amounts span BTC (8 decimals matter) to SHIB (they don't), so the
 * precision follows the magnitude instead of being fixed.
 */
export function qty(value: number): string {
  const abs = Math.abs(value)
  if (abs === 0) return '0'
  let decimals: number
  if (abs >= 1_000) decimals = 2
  else if (abs >= 1) decimals = 4
  else if (abs >= 0.001) decimals = 6
  else decimals = 8
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value)
}

export function price(value: number): string {
  const abs = Math.abs(value)
  const decimals = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 5 : 8
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  }).format(value)
}

/** `ratio` is on a 0–1 scale: 0.0234 renders as "+2,34 %". */
export function pct(ratio: number, digits = 2): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: 'exceptZero',
  }).format(ratio)
}

/** Same scale as `pct` but without forcing a sign — for weights and shares. */
export function share(ratio: number, digits = 1): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(ratio)
}

export function signedUsd(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${usd(Math.abs(value))}`
}

export function dateTime(ms: string | number): string {
  const value = typeof ms === 'string' ? Number(ms) : ms
  if (!Number.isFinite(value) || value === 0) return '—'
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function timeAgo(ms: number): string {
  const seconds = Math.round((Date.now() - ms) / 1000)
  if (seconds < 5) return 'ahora mismo'
  if (seconds < 60) return `hace ${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  return `hace ${Math.round(hours / 24)} d`
}
