import { expect, test } from '@playwright/test'
import { expectNoBrokenText, expectNoOverflow, expectTheme, usingTheme, watchProblems } from './helpers'

/**
 * El Resumen, con la cuenta real a través del proxy de la app (lectura). No se afirma ninguna cifra, porque cambian: se
 * afirma lo que tiene que ser cierto con cualquier cuenta — que carga, que no desborda, que no imprime NaN ni undefined
 * y que se ve en los dos temas — que es lo que ya falló alguna vez solo en pantalla.
 */

for (const theme of ['dark', 'light'] as const) {
  test(`el Resumen carga, no desborda y no imprime datos rotos (tema ${theme === 'dark' ? 'oscuro' : 'claro'})`, async ({ page }) => {
    const verify = watchProblems(page)
    await usingTheme(page, theme)
    await page.goto('/#/resumen')
    await expectTheme(page, theme)
    // The KPI strip and the health card are there once the account has loaded.
    await expect(page.getByText('Salud de la cuenta').first()).toBeVisible({ timeout: 45_000 })
    await expect(page.getByText('Ganancia abierta').first()).toBeVisible()
    await expect(page.getByText('Cerrado en 30 días').first()).toBeVisible()
    // The skeletons are gone: nothing is left loading.
    await expect(page.locator('.skeleton')).toHaveCount(0, { timeout: 30_000 })
    await expectNoOverflow(page)
    await expectNoBrokenText(page)
    verify()
  })
}

test('desde el Resumen se llega a todas las secciones, también en el móvil', async ({ page }, info) => {
  await page.goto('/#/resumen')
  await expect(page.getByText('Salud de la cuenta').first()).toBeVisible({ timeout: 45_000 })
  const phone = info.project.name.includes('móvil')
  // Every route must be reachable: on a phone the overflow menu once left Bots out entirely.
  if (phone) await page.getByRole('button', { name: 'Más', exact: true }).click()
  for (const name of ['Bots', 'Seguimiento', 'Financiación', 'Screener']) {
    await expect(page.getByRole('button', { name }).first(), `falta «${name}» en la navegación`).toBeVisible()
  }
})
