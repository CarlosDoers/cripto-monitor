---
name: warn-delete-caches
enabled: true
event: bash
action: block
pattern: rm\s+(-\w+\s+)*\S*\.(research|candles\S*|funding)\b
---

🛑 **Vas a borrar una caché de investigación.**

`.research`, `.candles*` y `.funding` cuestan de minutos a horas reconstruirlas (descargas de Binance, OKX y Yahoo, hasta 120 MB por moneda en 1 m) y las mediciones citadas en CLAUDE.md salen de ellas. Bórralas solo si el usuario lo ha pedido expresamente.
