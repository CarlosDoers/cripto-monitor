import { timingSafeEqual } from 'node:crypto'

/**
 * Vercel's cron sends `Authorization: Bearer $CRON_SECRET`, and only when
 * CRON_SECRET is set. An external scheduler (a GitHub Actions workflow, a
 * pinger) sends the same header, so one secret opens every scheduled entry.
 * A secret under 16 characters is refused outright: a short one is guessable,
 * and "set but weak" must not read as "protected".
 */
export function isCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? ''
  const given = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  return secret.length >= 16 && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}
