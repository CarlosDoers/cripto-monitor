// Bundles the claude.ai connector (src/lib/mcp.ts and everything it imports
// from the app) into api/_mcp.js, the file the Vercel function api/mcp.ts
// loads. Run by `npm run build`; the output is generated and gitignored.
//
// Without a bundle the function cannot load the app's code: Vercel compiles
// each file under api/ on its own and leaves imports as written, and Node's
// ESM loader does not resolve the extensionless imports the app uses.
import { build } from 'vite'

await build({
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  build: {
    ssr: 'src/lib/mcp.ts',
    outDir: 'api',
    emptyOutDir: false,
    copyPublicDir: false,
    minify: false,
    rolldownOptions: { output: { entryFileNames: '_mcp.js', format: 'es' } },
  },
})
console.log('api/_mcp.js listo')
