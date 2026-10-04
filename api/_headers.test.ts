import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Not about the API: it lives here because this is the folder typechecked with
 * Node's types. The page's CSP allows its one inline script by hash; edit the
 * script without updating vercel.json and the browser blocks it silently — the
 * theme would flash on every load in production and nowhere else.
 */
describe('the page headers', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
    headers: { source: string; headers: { key: string; value: string }[] }[]
  }
  const csp = config.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')?.value ?? ''

  it('allows every inline script in index.html by its hash', () => {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
    expect(scripts.length).toBeGreaterThan(0)
    for (const script of scripts) {
      const hash = createHash('sha256').update(script).digest('base64')
      expect(csp).toContain(`'sha256-${hash}'`)
    }
  })

  it('loads fonts only from where index.html asks for them', () => {
    expect(html).toContain('https://fonts.googleapis.com')
    expect(csp).toContain('https://fonts.googleapis.com')
    expect(csp).toContain('https://fonts.gstatic.com')
  })

  it('keeps the page out of frames', () => {
    expect(csp).toContain("frame-ancestors 'none'")
  })
})
