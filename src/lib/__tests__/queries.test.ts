import { describe, expect, it } from 'vitest'
// The source as text, through Vite: src/ is typechecked without Node's types.
import source from '../queries.ts?raw'

/**
 * CLAUDE.md: "A query is fresh for as long as its own interval." The client
 * defaults to 20 s, so a 30 s query without its own staleTime is refetched by
 * every component that mounts between ticks — each a serverless invocation.
 * The bot lists and the stop orders had slipped through; this keeps the next
 * hand-written query from doing the same. It reads the source because the rule
 * is about how the options are written, not about what a hook returns.
 */
describe('every polled query declares how long it stays fresh', () => {
  // Each query's options start at its queryKey and run to the next one.
  const chunks: string[] = source.split(/(?=queryKey:)/).slice(1)

  it('finds the queries it is checking', () => {
    expect(chunks.length).toBeGreaterThan(20)
  })

  it('pairs every refetchInterval with a staleTime', () => {
    const missing = chunks
      .filter((c) => /refetchInterval:/.test(c) && !/staleTime:/.test(c))
      .map((c) => c.slice(0, 60).replace(/\s+/g, ' '))
    expect(missing).toEqual([])
  })
})
