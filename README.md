# Cripto Monitor

Panel de solo lectura para tu cuenta de OKX: patrimonio, cartera, posiciones,
órdenes, historial, estadísticas de trading e indicadores de señales. Vite + React + TypeScript, con una
función serverless que firma las peticiones a la API.

## Secciones

| Vista | Qué muestra |
| --- | --- |
| **Resumen** | Patrimonio, PnL abierto y realizado, win rate, curva de resultado y distribución |
| **Señales** | Indicador de reversión: envolvente sobre velas, señales long/short con objetivo y stop, y su fiabilidad histórica |
| **Rendimiento** | Win rate, factor de beneficio, curva de PnL, resultado por activo, dirección, hora del día y día de la semana |
| **Cartera** | Todos los activos con precio, variación 24 h y peso |
| **Posiciones** | Posiciones abiertas con liquidación, margen y PnL |
| **Órdenes** | Abiertas e historial por tipo de instrumento |
| **Historial** | Ejecuciones y movimientos de cuenta |

Las estadísticas de **Rendimiento** salen de `/api/v5/account/positions-history`,
donde OKX reporta el PnL por operación ya neto de comisiones y financiación. Las
operaciones de spot quedan fuera a propósito: OKX devuelve `fillPnl: 0` en spot,
así que un win rate ahí habría que estimarlo con un modelo de coste medio sobre
un historial truncado, y saldrían cifras con apariencia de fiables sin serlo.

**Señales** porta a TypeScript el indicador *Reversal Trap Probability Bands*
(BigBeluga, TradingView). Los cálculos base (EMA, RMA, ATR, RSI) replican el
pseudocódigo publicado de Pine Script, incluida la forma de sembrar las medias,
que es donde suelen desviarse las traducciones. El backtest es simplificado: sin
comisiones ni deslizamiento, y una vela que toca objetivo y stop a la vez cuenta
como acierto, igual que en el original. **El porcentaje de aciertos por sí solo
no dice si un sistema gana**: con beneficio/riesgo cercano a 3, un 30 % de
acierto ya es rentable, así que la vista muestra el resultado esperado en R.

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

### Primera vez

```bash
vercel login
vercel link             # crea o enlaza el proyecto
./scripts/push-env.sh   # sube las variables desde .env.local
vercel --prod
```

`push-env.sh` publica cada variable de `.env.local` en *Production* y *Preview*,
marcando las cuatro credenciales como **sensibles** para que Vercel las cifre y
no vuelva a mostrarlas. Omite las variables `VERCEL_*`, que inyecta la propia
plataforma en cada deployment.

> `OKX_BASE_URL` no es opcional: si tu clave pertenece a una entidad regional,
> sin esa variable Vercel llamaría al dominio global y OKX respondería
> `API key doesn't exist`.

Si prefieres el panel, las variables van en **Settings → Environment Variables**.
En ese caso hay que **volver a desplegar** después de añadirlas (Deployments →
⋯ → Redeploy): solo se aplican a builds nuevos.

### Cada cambio

```bash
git push        # publica el código
vercel --prod   # despliega
```

Son dos pasos independientes: subir a GitHub no despliega nada. Para que el push
dispare el deploy hay que conectar el repositorio en *Settings → Git*, lo que
requiere instalar la app de Vercel en la cuenta de GitHub que sea dueña del repo.

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
    performance.ts estadísticas de trading
    signals.ts     velas + indicador
    indicators/    ta.ts (EMA/RMA/ATR/RSI, iguales a Pine) + reversalTrap.ts
  components/      Layout, tarjetas, tablas, gráficos (velas, curva, barras)
  views/           Resumen, Señales, Rendimiento, Cartera, Posiciones, Órdenes, Historial
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
  hayas copiado mal: significa que estás llamando al dominio equivocado. Prueba
  `https://eea.okx.com` (Europa) o `https://app.okx.com` (EE. UU.) — el error de
  la app ya incluye la pista.
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
