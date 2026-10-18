import { expect, type Page } from '@playwright/test'

/** Nothing sticks out of the page: the one check that broke on a phone more often than any other. */
export async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, 'la página es más ancha que la pantalla').toBeLessThanOrEqual(0)
}

/** Text that only appears when a number or a field was not what the code assumed. */
const BROKEN = /\bNaN\b|\bundefined\b|\bInfinity\b|\[object Object\]|\bnull\b/

export async function expectNoBrokenText(page: Page) {
  const text = await page.evaluate(() => document.body.innerText)
  const hit = text.split('\n').find((line) => BROKEN.test(line))
  expect(hit, `texto roto en pantalla: «${hit}»`).toBeUndefined()
}

/**
 * Collects what the browser itself complains about: uncaught errors, console errors and answers of 500 or more from
 * the app's own API. Returns a function that fails the test if any came up. A 429 is OKX's rate limit and is retried
 * by the app, so it is not counted.
 */
export function watchProblems(page: Page) {
  const problems: string[] = []
  page.on('pageerror', (err) => problems.push(`error de página: ${err.message}`))
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    // The browser's own line for a failed request is covered by the response check below.
    if (/Failed to load resource/.test(text)) return
    problems.push(`consola: ${text}`)
  })
  page.on('response', (res) => {
    const url = new URL(res.url())
    if (url.pathname.startsWith('/api/') && res.status() >= 500) problems.push(`${res.status()} en ${url.pathname}${url.search}`)
  })
  return () => expect(problems, 'el navegador se quejó').toEqual([])
}

/**
 * Opens the app in a given theme: the choice the toggle stores, written before the page's own script reads it, so the first
 * paint is already that theme. Call it before `goto`.
 */
export async function usingTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => localStorage.setItem('cripto-monitor:theme', t), theme)
}

/** The theme really applied, read from the page and not assumed from what was asked. */
export async function expectTheme(page: Page, theme: 'light' | 'dark') {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  const luminance = await page.evaluate(() => {
    const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g)!.map(Number)
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  })
  if (theme === 'dark') expect(luminance, 'el fondo no es oscuro').toBeLessThan(0.3)
  else expect(luminance, 'el fondo no es claro').toBeGreaterThan(0.7)
}
