# ARQUITECTURA.md — Estado técnico actual

> Este documento refleja el estado real del proyecto, no el plan. Se actualiza
> cada vez que cambia algo técnico relevante.

## Estado actual

- Paso 1 construido: resumen semanal de sesiones vía skill `resumen-semanal`.
  Solo lectura, no escribe todavía en ningún sitio.
- Paso 2 construido: lógica de descuento/renovación de programas
  (`programas/logica.py`, `programas/procesar.py`) y base de datos de
  clientes en `datos/clientes.xlsx`, un Excel con formato (colores,
  desplegables, filtros) generado por `clientes/generar_plantilla.py` y
  leído/escrito por `clientes/repositorio.py`. Probado de punta a punta con
  datos de ejemplo.

## Stack técnico (decidido 2026-07-14, revisado el mismo día)

Fernando ya tenía Google Calendar conectado a Claude (conector de claude.ai),
así que no hace falta ningún código de autenticación propio: Claude lee el
calendario directamente a través de ese conector, ya autorizado.

| Pieza | Elección | Por qué |
|---|---|---|
| Lectura de Calendar | Conector `claude.ai Google Calendar` (ya autorizado) | Ya existe y funciona; construir una autenticación propia (OAuth/cuenta de servicio) habría sido complejidad innecesaria — ver lección en `.claude/skills/lessons-learned/log.md` |
| Clasificación de sesiones | Python puro, sin dependencias externas (`calendar_integration/parser.py`, `summary.py`) | Lógica determinista (no "a ojo" por IA) para que el conteo de sesiones sea siempre reproducible |
| Interfaz | Conversación con Claude Code (skill `resumen-semanal`) | No hace falta una app aparte: Fernando pide el resumen y Claude lo genera usando el conector + el script de clasificación |
| Base de datos de clientes/programas | Excel local `datos/clientes.xlsx`, con formato (`clientes/repositorio.py`, `openpyxl`) | Ver decisión del 2026-07-15 más abajo — Fernando pidió explícitamente que fuera "bonito y profesional", no un CSV plano |

Se descartó Streamlit + SQLite + cuenta de servicio de Google Cloud (construido
y luego eliminado el mismo día) porque duplicaba algo que ya existía.

### Decisión: CSV local en vez de Notion o Google Sheets (2026-07-15)

El plan original (`SYSTEM_VISION.md`) usaba Notion para clientes/programas y
Google Sheets para el resumen económico. Se cambió por lo siguiente:

- **Notion**: el conector de Notion de claude.ai no está disponible en este
  proyecto (ni siquiera en estado "pendiente de autorizar" — no está dado de
  alta). Fernando confirmó que tampoco lleva hoy sus clientes en Notion de
  verdad, así que no hay datos que migrar.
- **Google Sheets**: el conector de Google Drive ya disponible puede *crear*
  y *leer* archivos, pero no tiene ninguna herramienta para actualizar una
  hoja ya existente (ni añadir filas, ni editar celdas). Automatizar la
  escritura habría requerido montar de nuevo una autenticación propia contra
  la API de Google Sheets — la misma complejidad que ya se descartó una vez
  para Calendar (ver lección en el log).
- Fernando indicó que no necesita que sea en la nube, solo que sea "operativo,
  efectivo y eficiente", y que él mismo rellena los datos a mano (son pocos
  clientes).

Se optó por un **archivo Excel local** (`datos/clientes.xlsx`), que Fernando
edita directamente abriéndolo en Excel, y que Claude lee y escribe
directamente como cualquier archivo del proyecto — sin conectores, sin
credenciales, sin configuración adicional. Es la opción más simple que
cumple el objetivo.

Primera versión: se generó como CSV plano, pero Fernando pidió un Excel
"bonito y profesional" para rellenar los datos a gusto. Se regeneró como
`.xlsx` con `openpyxl` (título, colores, cabecera fija, filtro, desplegable
Sí/No para "pendiente de pago" y resaltado en rojo/verde). Al escribir las
actualizaciones semanales solo se cambian valores de celda, nunca el
formato, así que el aspecto no se pierde con el uso.

Fernando compartió después las tarifas reales de Antifrágil (ver
`docs/TARIFAS.md`). Se añadió una segunda hoja "Programas" con los 7
programas reales (tarifa + sesiones totales) y un desplegable en "Tipo de
programa" que autorrellena la tarifa y las sesiones totales mediante
`VLOOKUP`. Si Fernando cambia un precio, solo edita la hoja "Programas" —
no hace falta tocar código. Los colores de los eventos de Calendar son solo
orientativos para Fernando; el sistema relaciona tarifa/programa únicamente
por nombre de cliente contra este Excel, nunca por color (ver lección en el
log del 2026-07-15).

Nota técnica: tarifa y sesiones totales son fórmulas, no valores fijos —
Fernando debe guardar el archivo (Ctrl+S) tras elegir un programa (o tras
cualquier cambio hecho por el sistema) para que Excel las recalcule y
`clientes/repositorio.py` (que lee con `data_only=True`) pueda ver el
resultado. Ver lección del 2026-07-15 sobre por qué esto es necesario.

Fernando también pidió (2026-07-15) anotar las **sesiones llevadas**
(consumidas del bono actual) en vez de las que quedan — le resulta más
natural. La columna E del Excel se llama "Sesiones llevadas";
`clientes/repositorio.py` convierte a "restantes" (`sesiones_totales -
sesiones_llevadas`) solo para alimentar `programas/procesar.py`, cuya
lógica interna no cambió.

## Estructura de carpetas

```
antifragil/
  calendar_integration/
    parser.py        # clasifica un título de evento (PT/CrossFit Lidomare/Kids)
    summary.py        # agrupa eventos clasificados en un resumen semanal
    resumen_cli.py     # CLI: recibe el array de eventos por stdin, devuelve resumen JSON
  programas/
    logica.py          # descuento y renovación de un programa individual
    procesar.py         # combina el resumen semanal con los programas actuales
  clientes/
    generar_plantilla.py  # crea datos/clientes.xlsx con formato (una sola vez)
    repositorio.py         # lee/escribe datos/clientes.xlsx
  datos/
    clientes.xlsx           # base de datos real, con formato (nunca en Git)
    clientes.example.csv     # plantilla de ejemplo (estructura de columnas), sí versionada
  .claude/skills/resumen-semanal/SKILL.md   # orquesta el flujo del paso 1
```

`calendar_integration/` y `programas/` contienen solo lógica pura (sin
credenciales, sin llamadas de red). `clientes/` sí toca disco, pero es un
archivo local del propio proyecto, no un servicio externo — la obtención de
eventos reales de Calendar la hacen los skills a través del conector ya
autorizado.

### Regla de negocio de `programas/logica.py` (confirmada por Fernando, 2026-07-15)

Al agotarse un bono a mitad de semana, se renueva automáticamente con el
mismo número de sesiones y las sesiones "de más" de esa semana cuentan ya
contra el bono nuevo (no se pierden ni se regalan). El bono nuevo queda
marcado como pendiente de pago.

## Orden de construcción de la V1 (decidido 2026-07-14, ajustado 2026-07-15)

Fernando confirmó que la V1 se construye en pasos pequeños y verificables, no de
una vez. Orden acordado:

1. Leer Google Calendar y mostrar en pantalla las sesiones detectadas por cliente
   (PT, CrossFit Lidomare, CrossFit Kids). Sin escritura en ningún sitio todavía. ✅
2. Lógica de programas (descuento, aviso, renovación) + base de datos de
   clientes en `datos/clientes.xlsx`, en vez de Notion (ver decisión arriba). ✅
3. Unir el paso 1 y el paso 2 en un solo skill semanal: leer Calendar,
   calcular, mostrar resumen y esperar confirmación de Fernando antes de
   escribir en `datos/clientes.xlsx`.
4. Resumen económico semanal/mensual — probablemente también como archivo
   local en vez de Google Sheets, a decidir cuando llegue el momento.

Cada paso debe verse funcionando antes de empezar el siguiente.

## Próximos pasos técnicos pendientes de decidir

- Fernando debe rellenar `datos/clientes.xlsx` con tarifa, tipo de programa,
  sesiones totales y restantes de sus clientes actuales
- Construir el skill del paso 3 (unir Calendar + programas + confirmación)
- Decidir el formato del resumen económico del paso 4

## Principios de arquitectura (de SYSTEM_VISION.md)

- Módulos independientes: Calendar, base de datos de clientes, resumen
  económico e interfaz no deben mezclarse en una sola pieza de código.
- Ninguna escritura en la base de datos de clientes sin confirmación previa
  del usuario (antes era "Notion o Sheets"; el principio es el mismo,
  cambió solo dónde vive el dato — ver decisión del 2026-07-15).
- Diseñada para escalar a futuros módulos (fisioterapia, nutrición, psicología,
  finanzas, etc.) sin rehacer la base.
