// Node's ESM resolver requires the extension; the app's source omits it because
// the bundler adds it. This hook lets `node --import` run src/ files directly,
// so the audit scripts execute the very same code the app ships.
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
    const base = new URL(specifier, context.parentURL)
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      const candidate = new URL(base.href + ext)
      if (existsSync(fileURLToPath(candidate))) {
        return next(pathToFileURL(fileURLToPath(candidate)).href, context)
      }
    }
  }
  return next(specifier, context)
}
