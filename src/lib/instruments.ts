/**
 * Which OKX instrument list an id belongs to — and so which ticker and
 * instrument request prices it. Bot positions and typed-in contracts arrive as
 * bare ids, and asking the wrong list returns nothing rather than an error.
 */
export function instTypeOf(instId: string): 'SWAP' | 'FUTURES' | 'SPOT' {
  if (instId.endsWith('-SWAP')) return 'SWAP'
  if (instId.includes('_UM_XPERP') || /-\d{6}$/.test(instId)) return 'FUTURES'
  return 'SPOT'
}
