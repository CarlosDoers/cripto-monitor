---
name: warn-bare-table-wrap
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: src/.*\.tsx$
  - field: new_text
    operator: regex_match
    pattern: <div\s+className=["']table-wrap["']
---

⚠️ **Tabla con `div.table-wrap` a pelo.**

Toda tabla de datos va dentro de `TableWrap` (`src/components/ui.tsx`): por debajo de 720 px cada fila se redibuja como tarjeta y `TableWrap` copia el texto de la cabecera a cada celda como `data-label`. Con un `div` normal las celdas salen sin etiqueta. Y una celda con varias piezas va envuelta en un único elemento.
