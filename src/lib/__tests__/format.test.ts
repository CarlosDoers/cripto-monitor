import { describe, expect, it } from 'vitest'
import { compactUsd } from '../format'

describe('compactUsd', () => {
  it('prints a daily volume the way the boards do, without cents under a million', () => {
    expect(compactUsd(157_682)).toBe('158 k$')
    expect(compactUsd(37_345.02)).toBe('37 k$')
    expect(compactUsd(6_961_024)).toBe('7,0 M$')
    expect(compactUsd(1_540_664)).toBe('1,5 M$')
    expect(compactUsd(3_100_000_000)).toBe('3,10 B$')
  })
})
