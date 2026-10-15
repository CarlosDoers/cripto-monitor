// Bundles what the Vercel functions need from the app's own code, one file each:
//
//   src/lib/mcp.ts      → api/_mcp.js    the claude.ai connector (api/mcp.ts)
//   src/lib/watchJob.ts → api/_watch.js  the tracking ledger's job (api/watch.ts)
//
// Run by `npm run build`; the outputs are generated and gitignored.
//
// Without a bundle a function cannot load the app's code: Vercel compiles each
// file under api/ on its own and leaves imports as written, and Node's ESM
// loader does not resolve the extensionless imports the app uses.
import { build } from 'vite'

const bundles = [
  ['src/lib/mcp.ts', '_mcp.js'],
  ['src/lib/watchJob.ts', '_watch.js'],
]

for (const [entry, file] of bundles) {
  await build({
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    build: {
      ssr: entry,
      outDir: 'api',
      emptyOutDir: false,
      copyPublicDir: false,
      minify: false,
      rolldownOptions: { output: { entryFileNames: file, format: 'es' } },
    },
  })
  console.log(`api/${file} listo`)
}
