import { expect, test } from '@playwright/test'
import { expectNoBrokenText, expectNoOverflow, watchProblems } from './helpers'

/**
 * Rendimiento con la cuenta real (lectura): las dos tarjetas que analizan las operaciones propias. No se afirma ninguna cifra
 * —cambian con cada operación—, solo lo que debe cumplirse con cualquier cuenta: que se ven, que cada grupo dice su tamaño,
 * que no hay texto roto ni desbordes y que la comparación con la regla termina con un resultado o con una explicación.
 */

test('«Cómo operas» enseña los hábitos sin desbordar ni imprimir datos rotos', async ({ page }) => {
  const verify = watchProblems(page)
  await page.goto('/#/rendimiento')
  const card = page.locator('section, .card').filter({ has: page.getByRole('heading', { name: 'Cómo operas' }) }).first()
  test.skip((await card.count()) === 0 && (await page.getByText(/Aún no hay operaciones cerradas|Sin operaciones cerradas/).count()) > 0, 'la cuenta no tiene operaciones cerradas')
  await expect(card).toBeVisible({ timeout: 45_000 })
  // Every comparison says how many trades it rests on.
  await expect(card.getByText(/\d+ ops?/).first()).toBeVisible()
  await expectNoOverflow(page)
  await expectNoBrokenText(page)
  verify()
})

test('«frente a la regla» compara con la regla y termina con un resultado o con una razón', async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto('/#/rendimiento')
  const button = page.getByRole('button', { name: 'Comparar con la regla' })
  test.skip((await button.count()) === 0 && (await page.getByText(/Aún no hay operaciones cerradas|Sin operaciones cerradas/).count()) > 0, 'la cuenta no tiene operaciones cerradas')
  await expect(button).toBeEnabled({ timeout: 45_000 })
  await button.click()
  await expect(page.getByText(/Se colocaron \d+ operaci|Ninguna de las operaciones se pudo colocar/)).toBeVisible({ timeout: 120_000 })
  await expectNoOverflow(page)
  await expectNoBrokenText(page)
})
