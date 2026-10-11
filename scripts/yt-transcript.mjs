// The transcript of a YouTube video, with its title, channel, chapters and the
// description, for analysing a trading idea someone describes in a video.
//
//   npm run transcript -- https://www.youtube.com/watch?v=<id> [salida.txt]
//
// Written to stdout, or to the file given. Timestamps every 30 s so a passage
// can be found again: "minuto 15:43 del vídeo".
//
// How: the watch page carries the Innertube API key; the Android client's
// `player` call returns caption tracks whose URLs work without the
// proof-of-origin token the web client's URLs now need (those answer 200 with an
// empty body). Undocumented and it will break some day — when it does, the
// symptom is "sin subtítulos" or an empty track, not a wrong transcript.
// Personal tooling: it reads what a browser reads, nothing is posted anywhere.
import { writeFileSync } from 'node:fs'

const arg = process.argv[2]
const out = process.argv[3]
if (!arg) {
  console.error('uso: npm run transcript -- <url o id del vídeo> [fichero de salida]')
  process.exit(2)
}
const id = (arg.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/) ?? arg.match(/^([\w-]{11})$/))?.[1]
if (!id) {
  console.error(`no reconozco un id de vídeo en: ${arg}`)
  process.exit(2)
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const page = await (
  await fetch(`https://www.youtube.com/watch?v=${id}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8', Cookie: 'CONSENT=YES+1' },
  })
).text()

const pick = (re) => re.exec(page)?.[1]
const json = (s) => { try { return JSON.parse(`"${s}"`) } catch { return s } }
const title = json(pick(/"title":"((?:[^"\\]|\\.)*)","lengthSeconds"/) ?? '')
const channel = json(pick(/"ownerChannelName":"((?:[^"\\]|\\.)*)"/) ?? '')
const seconds = Number(pick(/"lengthSeconds":"(\d+)"/) ?? 0)
const description = json(pick(/"shortDescription":"((?:[^"\\]|\\.)*)","isCrawlable"/) ?? '')
const key = pick(/"INNERTUBE_API_KEY":"([^"]+)"/)
if (!key) {
  console.error('no encuentro la clave de la API en la página (¿vídeo no disponible o página de consentimiento?)')
  process.exit(1)
}

const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${key}&prettyPrint=false`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip' },
  body: JSON.stringify({
    context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, hl: 'es', gl: 'ES' } },
    videoId: id,
  }),
})
const player = await res.json()
const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
if (!tracks.length) {
  console.error(`sin subtítulos: ${player.playabilityStatus?.status ?? '?'} ${player.playabilityStatus?.reason ?? ''}`)
  process.exit(1)
}
// Spanish first (a written track before an automatic one), then English, then whatever there is.
const rank = (t) => (t.languageCode === 'es' ? 0 : t.languageCode === 'en' ? 10 : 20) + (t.kind === 'asr' ? 1 : 0)
const track = [...tracks].sort((a, b) => rank(a) - rank(b))[0]
const xml = await (await fetch(track.baseUrl, { headers: { 'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip' } })).text()
if (xml.length < 200) {
  console.error('la pista de subtítulos vino vacía (YouTube ha cambiado algo)')
  process.exit(1)
}

const decode = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ').trim()
const cues = [...xml.matchAll(/<p t="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => ({ t: Number(m[1]) / 1000, text: decode(m[2]) })).filter((c) => c.text)
if (!cues.length) {
  for (const m of xml.matchAll(/<text start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)) cues.push({ t: Number(m[1]), text: decode(m[2]) })
}

const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const lines = [`# ${title}`, `Canal: ${channel} · duración ${clock(seconds)} · subtítulos: ${track.languageCode}${track.kind === 'asr' ? ' (automáticos)' : ''}`, '', '## Descripción', description, '', '## Transcripción']
let last = -100
let row = ''
for (const c of cues) {
  if (c.t - last >= 30) {
    if (row) lines.push(row)
    row = `[${clock(c.t)}] `
    last = c.t
  }
  row += `${c.text} `
}
if (row) lines.push(row)

const text = lines.join('\n') + '\n'
if (out) {
  writeFileSync(out, text)
  console.error(`${cues.length} fragmentos, ${text.length} caracteres → ${out}`)
} else {
  process.stdout.write(text)
}
