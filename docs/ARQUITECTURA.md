# ARQUITECTURA.md — Estado técnico actual

> Este documento refleja el estado real del proyecto, no el plan. Se actualiza
> cada vez que cambia algo técnico relevante.

## Estado actual

Paso 1 construido: resumen semanal de sesiones vía skill `resumen-semanal`.
Solo lectura, no escribe todavía en ningún sitio.

## Stack técnico (decidido 2026-07-14, revisado el mismo día)

Fernando ya tenía Google Calendar conectado a Claude (conector de claude.ai),
así que no hace falta ningún código de autenticación propio: Claude lee el
calendario directamente a través de ese conector, ya autorizado.

| Pieza | Elección | Por qué |
|---|---|---|
| Lectura de Calendar | Conector `claude.ai Google Calendar` (ya autorizado) | Ya existe y funciona; construir una autenticación propia (OAuth/cuenta de servicio) habría sido complejidad innecesaria — ver lección en `.claude/skills/lessons-learned/log.md` |
| Clasificación de sesiones | Python puro, sin dependencias externas (`calendar_integration/parser.py`, `summary.py`) | Lógica determinista (no "a ojo" por IA) para que el conteo de sesiones sea siempre reproducible |
| Interfaz | Conversación con Claude Code (skill `resumen-semanal`) | No hace falta una app aparte: Fernando pide el resumen y Claude lo genera usando el conector + el script de clasificación |
| Notion / Google Sheets (pasos futuros) | Conectores de claude.ai (Notion pendiente de autorizar por Fernando) | Misma lógica: usar lo ya conectado en vez de construir autenticación propia |
| Base de datos interna | Aún no decidida | Se decide en el paso 2, cuando haga falta guardar el estado de los programas (sesiones restantes, renovaciones) |

Se descartó Streamlit + SQLite + cuenta de servicio de Google Cloud (construido
y luego eliminado el mismo día) porque duplicaba algo que ya existía.

## Estructura de carpetas

```
antifragil/
  calendar_integration/
    parser.py        # clasifica un título de evento (PT/CrossFit Lidomare/Kids)
    summary.py        # agrupa eventos clasificados en un resumen semanal
    resumen_cli.py     # CLI: recibe títulos por stdin, devuelve resumen JSON
  .claude/skills/resumen-semanal/SKILL.md   # orquesta el flujo completo
```

`calendar_integration/` contiene solo lógica pura (sin credenciales, sin
llamadas de red) — la obtención de los eventos reales la hace el skill a
través del conector ya autorizado.

## Orden de construcción de la V1 (decidido 2026-07-14)

Fernando confirmó que la V1 se construye en pasos pequeños y verificables, no de
una vez. Orden acordado:

1. Leer Google Calendar y mostrar en pantalla las sesiones detectadas por cliente
   (PT, CrossFit Lidomare, CrossFit Kids). Sin escritura en ningún sitio todavía.
2. Añadir la lógica de programas: descuento de sesiones, aviso de "queda una
   sesión", renovación automática al llegar a cero.
3. Conectar Notion (con confirmación previa de Fernando antes de escribir).
4. Conectar Google Sheets (resumen económico semanal/mensual).

Cada paso debe verse funcionando antes de empezar el siguiente.

## Próximos pasos técnicos pendientes de decidir

- Diseño de la base de datos interna (clientes, programas, sesiones, pagos) —
  necesaria para el paso 2 (lógica de programas y renovaciones)
- Confirmar si el conector de Google Sheets/Drive ya está autorizado o hace
  falta que Fernando lo conecte, cuando lleguemos al paso 4
- Fernando debe autorizar el conector de Notion cuando lleguemos al paso 3

## Principios de arquitectura (de SYSTEM_VISION.md)

- Módulos independientes: Google Calendar, Notion, Google Sheets, base de datos
  interna e interfaz no deben mezclarse en una sola pieza de código.
- Ninguna escritura en Notion o Google Sheets sin confirmación previa del usuario.
- Diseñada para escalar a futuros módulos (fisioterapia, nutrición, psicología,
  finanzas, etc.) sin rehacer la base.
