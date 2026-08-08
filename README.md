# Cripto Monitor

Panel de solo lectura para tu cuenta de OKX: patrimonio, cartera, posiciones,
órdenes e historial. Vite + React + TypeScript, con una función serverless que
firma las peticiones a la API.

---

## Dónde va la API key (lo importante)

**Las claves nunca llegan al navegador.** Van en variables de entorno del
servidor, y solo las lee la función en [api/_okx.ts](api/_okx.ts):

| Variable | Qué es |
| --- | --- |
| `OKX_API_KEY` | La API key |
| `OKX_API_SECRET` | El secret |
| `OKX_API_PASSPHRASE` | La passphrase que elegiste al crear la clave |
| `APP_ACCESS_TOKEN` | Contraseña para entrar a la app. Opcional en local, **necesaria en producción** |
| `OKX_BASE_URL` | Opcional. Dominio de OKX según tu región |
| `OKX_SIMULATED` | Opcional. `1` para usar la cuenta demo |

> ⚠️ **Nunca les pongas el prefijo `VITE_`.** Vite incrusta cualquier variable
> `VITE_*` en el JavaScript que descarga el navegador — tu secret quedaría a la
> vista de cualquiera que abra las DevTools.

El navegador solo habla con `/api/okx`, que firma la petición del lado del
servidor y devuelve la respuesta.

```
navegador ──▶ /api/okx?path=/api/v5/account/balance
                  │  (aquí viven las claves: firma HMAC-SHA256)
                  └──▶ https://www.okx.com/api/v5/account/balance
```

---

## 1. Crear la API key en OKX

1. Entra en OKX → perfil → **API** → *Crear API v5*.
2. Permisos: marca **solo «Leer»** (*Read*). No marques *Trade* ni *Withdraw*.
3. Anota la **API key**, el **secret** y la **passphrase** que tú eliges.
4. Si puedes, restringe la clave a la IP de tu deploy (Vercel no da IPs fijas en
   el plan Hobby, así que probablemente lo dejarás abierto — por eso importa el
   punto 3 de más abajo).

Con permiso de solo lectura, la clave no puede operar ni retirar fondos aunque
se filtrara.

---

## 2. Desarrollo local

```bash
npm install
cp .env.example .env.local   # y rellena las tres claves
npm run dev
```

Abre http://localhost:5173. El `npm run dev` también ejecuta la función de
`api/` dentro del servidor de Vite, así que no necesitas la CLI de Vercel.

---

## 3. Desplegar en Vercel

Elegí **Vercel** sobre Netlify porque detecta Vite sin configurar nada y sirve
el directorio `api/` como funciones con el mismo formato web estándar
(`Request`/`Response`) que ya usa el código. En Netlify habría que mover las
funciones a `netlify/functions/` y adaptar la firma.

```bash
git init && git add -A && git commit -m "Cripto Monitor"
# sube el repo a GitHub, luego en vercel.com: Add New → Project → importar
```

Vercel detecta Vite solo. En **Settings → Environment Variables** añade:

```
OKX_API_KEY          = tu key
OKX_API_SECRET       = tu secret
OKX_API_PASSPHRASE   = tu passphrase
APP_ACCESS_TOKEN     = una contraseña larga (openssl rand -base64 32)
OKX_BASE_URL         = https://eea.okx.com
```

> `OKX_BASE_URL` no es opcional en este caso: **esta cuenta está en la entidad
> europea**. Sin esa variable, Vercel usaría el dominio global y OKX respondería
> `API key doesn't exist`. Es el mismo valor que tienes en `.env.local`.

Marca las cinco para *Production*, *Preview* y *Development*. Después de
añadirlas, **vuelve a desplegar** (Deployments → ⋯ → Redeploy): las variables
solo se aplican a builds nuevos.

### Protege el acceso

Tu URL de Vercel es pública. Sin `APP_ACCESS_TOKEN`, cualquiera que dé con ella
ve tu cartera. Con la variable puesta, la app pide la contraseña una vez y la
guarda en el navegador.

Si tienes plan Pro, *Settings → Deployment Protection → Vercel Authentication*
es aún mejor: exige tu login de Vercel para todo el deployment.

---

## Seguridad: qué protege qué

- **Solo GET, y solo endpoints en lista blanca.** El proxy tiene una lista
  cerrada de rutas de lectura ([api/_okx.ts](api/_okx.ts)). Una petición a
  `/api/v5/trade/order` (crear orden) devuelve `403`, aunque tu clave tuviera
  permiso de trading.
- **Las claves no salen del servidor.** Ninguna variable `VITE_*` las toca.
- **La contraseña se compara en tiempo constante** y nunca se envía al cliente.
- **`.env.local` está en `.gitignore`.** Comprueba con `git status` que no
  aparece antes de tu primer commit.

---

## Estructura

```
api/
  _okx.ts          firma HMAC, lista blanca, proxy   ← aquí viven las claves
  okx.ts           handler de la función de Vercel
src/
  lib/
    api.ts         cliente HTTP hacia /api/okx
    queries.ts     hooks de TanStack Query (un hook por endpoint)
    portfolio.ts   fusiona trading + fondos + precios en la cartera
    colors.ts      asignación estable de color por moneda
    format.ts      formateo de cifras en es-ES
    router.ts      routing por hash, sin dependencias
  components/      Layout, tarjetas, tablas, barra de distribución, sparklines
  views/           Resumen, Cartera, Posiciones, Órdenes, Historial
  styles/          tokens.css (paleta y temas) + app.css
vite.config.ts     monta api/ en el servidor de desarrollo
vercel.json        rewrites de SPA y cabeceras
```

---

## Frecuencia de actualización

Los datos en vivo (balances, posiciones, precios, órdenes abiertas) se refrescan
cada **30 s**; los historiales, cada **5 min**. Las consultas se pausan cuando la
pestaña está en segundo plano, así que una pestaña olvidada no consume nada.

Si te acercas al límite de invocaciones del plan Hobby, sube `LIVE` y `SLOW` en
[src/lib/queries.ts](src/lib/queries.ts#L9-L14).

---

## Notas

- **Región.** OKX opera entidades regionales separadas y una clave solo existe en
  la suya. `API key doesn't exist` (código `50119`) casi nunca significa que la
  hayas copiado mal: significa que estás llamando al dominio equivocado. Esta
  cuenta usa `https://eea.okx.com`; el error de la app ya incluye la pista.
- **Endpoints nuevos.** Para consumir otro endpoint de OKX, añádelo a
  `ALLOWED_PATHS` en [api/_okx.ts](api/_okx.ts) y crea su hook en
  [src/lib/queries.ts](src/lib/queries.ts). Solo lectura.
- **Colores.** La paleta de la barra de distribución está validada para daltonismo
  en ambos temas. El color sigue a la moneda (BTC siempre del mismo color), no a
  su posición en el ranking. A partir del octavo activo, el resto se agrupa en
  «Otros».

## Comandos

```bash
npm run dev       # desarrollo, con las funciones de api/ incluidas
npm run build     # typecheck + build de producción a dist/
npm run preview   # sirve dist/ (sin las funciones de api/)
npm run lint
```
