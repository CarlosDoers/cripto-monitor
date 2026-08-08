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
#       vercel --prod
#
set -uo pipefail

cd "$(dirname "$0")/.."

[ -f .env.local ] || { echo "Falta .env.local"; exit 1; }
[ -d .vercel ]    || { echo "El proyecto no está enlazado. Ejecuta primero: vercel link"; exit 1; }

# Estas nunca deben poder leerse una vez subidas.
SECRETS="OKX_API_KEY OKX_API_SECRET OKX_API_PASSPHRASE APP_ACCESS_TOKEN"

# `vercel link` y `vercel env pull` escriben sus propias variables en
# .env.local. Vercel las inyecta ya en cada deployment: subirlas a mano las
# dejaría congeladas y caducadas.
is_reserved() {
  case "$1" in VERCEL_*|NX_DAEMON|TURBO_*) return 0 ;; *) return 1 ;; esac
}

pushed=0
skipped=0
failed=0

# El archivo se lee por el descriptor 3, no por stdin: `vercel` lee de stdin y
# se comería el resto del archivo, terminando el bucle tras la primera línea.
# Cada llamada recibe además </dev/null para que nunca espere entrada.
while IFS='=' read -r key value <&3; do
  case "$key" in ''|\#*) continue ;; esac
  key="$(printf '%s' "$key" | tr -d '[:space:]')"
  [ -z "$key" ] && continue

  if is_reserved "$key"; then
    echo "  ─ $key (la gestiona Vercel, se omite)"
    skipped=$((skipped+1))
    continue
  fi

  if [ -z "$value" ]; then
    echo "  ─ $key (vacío, se omite)"
    skipped=$((skipped+1))
    continue
  fi

  flag=""
  case " $SECRETS " in *" $key "*) flag="--sensitive" ;; esac

  ok=1
  for target in production preview; do
    vercel env rm "$key" "$target" --yes </dev/null >/dev/null 2>&1 || true
    # shellcheck disable=SC2086
    if ! err=$(vercel env add "$key" "$target" --value "$value" $flag --yes </dev/null 2>&1); then
      echo "  ✗ $key → $target FALLÓ:"
      printf '%s\n' "$err" | sed 's/^/      /' | tail -5
      ok=0
    fi
  done

  if [ $ok -eq 1 ]; then
    echo "  ✓ $key → production, preview${flag:+  (cifrada)}"
    pushed=$((pushed+1))
  else
    failed=$((failed+1))
  fi
done 3< .env.local

echo
echo "$pushed subidas · $skipped omitidas · $failed con error"
if [ $failed -gt 0 ]; then
  echo "Corrige los errores de arriba y vuelve a ejecutar."
  exit 1
fi
echo "Ahora despliega:  vercel --prod"
