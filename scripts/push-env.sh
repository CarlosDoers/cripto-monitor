#!/usr/bin/env bash
#
# Sube las variables de .env.local al proyecto de Vercel enlazado.
#
# Las credenciales se marcan como "sensitive": Vercel las guarda cifradas y no
# vuelve a mostrarlas en el panel ni por la CLI. Solo las lee la función en
# tiempo de ejecución.
#
# Uso:  vercel login && vercel link     (una vez)
#       ./scripts/push-env.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

[ -f .env.local ] || { echo "Falta .env.local"; exit 1; }
[ -d .vercel ]    || { echo "El proyecto no está enlazado. Ejecuta primero: vercel link"; exit 1; }

# Estas nunca deben poder leerse una vez subidas.
SECRETS="OKX_API_KEY OKX_API_SECRET OKX_API_PASSPHRASE APP_ACCESS_TOKEN"

pushed=0
skipped=0

while IFS='=' read -r key value; do
  case "$key" in ''|\#*) continue ;; esac
  key="${key%"${key##*[![:space:]]}"}"      # recorta espacios finales
  [ -z "$value" ] && { echo "  ─ $key (vacío, se omite)"; skipped=$((skipped+1)); continue; }

  flag=""
  case " $SECRETS " in *" $key "*) flag="--sensitive" ;; esac

  for target in production preview; do
    vercel env rm "$key" "$target" --yes >/dev/null 2>&1 || true
    # shellcheck disable=SC2086
    vercel env add "$key" "$target" --value "$value" $flag --yes >/dev/null
  done

  echo "  ✓ $key → production, preview${flag:+  (cifrada)}"
  pushed=$((pushed+1))
done < .env.local

echo
echo "$pushed variables subidas, $skipped omitidas."
echo "Ahora despliega:  vercel --prod"
