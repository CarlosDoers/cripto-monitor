import { handleOauth } from './_oauth.js'

/**
 * OAuth for the claude.ai connector: metadata, registration, consent and
 * tokens, all in `_oauth.ts`. `vercel.json` rewrites `/.well-known/oauth-*`
 * and `/api/oauth/<step>` onto this function.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return handleOauth(request)
  },
}
