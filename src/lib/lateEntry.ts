import type { LateBucket } from './indicators/donchianBreakout'
import { ratio, share } from './format'

/** What entering a trend late was measured to be worth, as the cards and the Claude text say it. */

const signedR = (x: number) => `${x >= 0 ? '+' : '−'}${ratio(Math.abs(x))}`

/**
 * The bucket an open position of `age` bars falls in, or null when it is older than anything measured. Age 0 and the
 * signal's own bar are the measured entry, not a late one: they have no bucket.
 */
export function lateBucket(age: number, buckets: LateBucket[]): LateBucket | null {
  if (age < buckets[0].from) return null
  return buckets.find((b) => age >= b.from && age <= b.to) ?? null
}

/**
 * One sentence for a row that is already in its trend: what entering at about this age measured, what is left without the
 * best ten trades, and how far away the stop is. The first figure is the headline and the others are why not to trust it.
 */
export function lateSentence(b: LateBucket): string {
  return `entrar a esta edad midió ${signedR(b.net)} R (${signedR(b.withoutBest10)} sin las diez mejores) con el stop a un ${share(b.riskPct, 0)} del precio`
}

/** The whole profile in one line, for the Claude text and the help: one figure per bucket, then what is left without the best ten. */
export function lateSummary(buckets: LateBucket[], unit: (b: LateBucket) => string): string {
  const head = buckets.map((b) => `${unit(b)} ${signedR(b.net)}`).join(', ')
  const tail = buckets.map((b) => signedR(b.withoutBest10)).join(' / ')
  return `${head}; sin las diez mejores operaciones ${tail}`
}
