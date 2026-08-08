import { handleOkxRequest } from './_okx.js'

/**
 * Vercel Function (Node.js runtime). Files prefixed with `_` are not deployed as
 * functions, so `_okx.ts` stays a plain shared module.
 */
export default {
  fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET') {
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'method_not_allowed' }), {
          status: 405,
          headers: { 'content-type': 'application/json', allow: 'GET' },
        }),
      )
    }
    return handleOkxRequest(request)
  },
}
