// Entry point for `node --import ./scripts/_hook.mjs <script>`. Registers the
// resolver that lets Node run the app's own TypeScript sources, so the audit
// measures the exact code the app ships instead of a copy of it.
import { register } from 'node:module'

register('./_ts-resolve.mjs', import.meta.url)
