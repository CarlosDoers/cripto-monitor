import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BlobPreconditionFailedError, get, put } from '@vercel/blob'
import type { LedgerStore } from './_watch.js'

/**
 * Where the tracking ledger (`src/lib/ledger.ts`) is kept: one private JSON file
 * in the same Vercel Blob store as the net-worth history, and in local
 * development a file under `.watch/`, so the whole flow can be tried with
 * `npm run dev` before anything is deployed.
 *
 * A write is conditional on what the run read (the blob's ETag; the file's
 * mtime and size), so two triggers at the same moment cannot overwrite each
 * other: the loser reads again and folds its work into the winner's ledger.
 * Reads bypass the CDN cache for the same reason — a stale read followed by a
 * write is how a record gets lost.
 */

const PATH = 'watch/ledger.json'

export type Storage = 'blob' | 'file'

/**
 * Where the ledger goes. On Vercel, the linked Blob store, or nowhere. Anywhere
 * else a local file — even when `.env.local` carries the production store's
 * token, because an experiment in `npm run dev` must not write into the
 * ledger the deployment keeps; `WATCH_STORAGE=blob` asks for the store on
 * purpose.
 */
export function ledgerStorage(): Storage | null {
  const store = process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : null
  if (process.env.VERCEL) return store
  return process.env.WATCH_STORAGE === 'blob' ? store : 'file'
}

const localDir = () => process.env.WATCH_LOCAL_DIR || '.watch'
const localFile = () => join(localDir(), 'ledger.json')

/**
 * `get` answers a larger body with a weak validator (`W/"…"`) and `head` and
 * `put` with the strong one, and the store only honours `ifMatch` against the
 * strong. Probed against a real store: the weak one stripped of its `W/` is the
 * same hash and is accepted; a stale one is refused.
 */
const strong = (etag: string | undefined | null): string | null => (etag ? etag.replace(/^W\//, '') : null)

const notFound = (err: unknown) => err instanceof Error && /not.?found|ENOENT/i.test(`${err.name} ${err.message} ${(err as { code?: string }).code ?? ''}`)

const blobStore: LedgerStore = {
  async read() {
    try {
      const blob = await get(PATH, { access: 'private', useCache: false })
      if (!blob || blob.statusCode !== 200) return { ledger: null, token: null }
      const ledger: unknown = JSON.parse(await new Response(blob.stream).text())
      return { ledger, token: strong(blob.blob.etag) }
    } catch (err) {
      if (notFound(err)) return { ledger: null, token: null }
      throw err
    }
  },
  async write(ledger, token) {
    try {
      const res = await put(PATH, JSON.stringify(ledger), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
        ...(token ? { ifMatch: token } : {}),
      })
      return { ok: true, token: strong(res.etag) }
    } catch (err) {
      if (err instanceof BlobPreconditionFailedError || /precondition/i.test(err instanceof Error ? `${err.name} ${err.message}` : '')) {
        return { ok: false, token }
      }
      throw err
    }
  },
}

const signature = async (): Promise<string | null> => {
  try {
    const s = await stat(localFile())
    return `${s.mtimeMs}:${s.size}`
  } catch (err) {
    if (notFound(err)) return null
    throw err
  }
}

const fileStore: LedgerStore = {
  async read() {
    try {
      const text = await readFile(localFile(), 'utf8')
      return { ledger: JSON.parse(text) as unknown, token: await signature() }
    } catch (err) {
      if (notFound(err)) return { ledger: null, token: null }
      throw err
    }
  },
  async write(ledger, token) {
    // Compare-and-swap on the file's signature: the dev server is one process, but a script may run beside it.
    if ((await signature()) !== token) return { ok: false, token }
    await mkdir(localDir(), { recursive: true })
    const tmp = `${localFile()}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(ledger))
    await rename(tmp, localFile())
    return { ok: true, token: await signature() }
  },
}

export function ledgerStore(): LedgerStore | null {
  const kind = ledgerStorage()
  return kind === 'blob' ? blobStore : kind === 'file' ? fileStore : null
}
