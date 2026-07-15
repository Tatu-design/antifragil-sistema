# Log de lecciones aprendidas

> Cada entrada: qué pasó, por qué pasó, qué se hace distinto a partir de ahora.

## 2026-07-14 — Construí autenticación OAuth/cuenta de servicio sin comprobar si ya existía conexión

**Qué pasó:** Diseñé y construí desde cero todo el flujo de autenticación contra
Google Calendar (proyecto en Google Cloud, cuenta de servicio, `credentials.json`,
guía de configuración de varios pasos) para el Hito 0. Fernando preguntó por qué
hacía falta todo ese proceso si él ya tenía Claude conectado a su Google Calendar
mediante el conector de claude.ai. Al comprobarlo, en efecto el conector ya estaba
autorizado y podía leer sus calendarios sin ningún código adicional.

**Por qué pasó:** No comprobé qué herramientas/conectores ya estaban disponibles
en el entorno antes de diseñar la arquitectura técnica. Asumí que había que
construir la integración desde cero en vez de verificar primero qué accesos
ya existían.

**Qué se hace distinto a partir de ahora:** Antes de diseñar cualquier
integración externa (Calendar, Notion, Sheets, etc.), comprobar primero si ya
existe un conector/MCP disponible y autorizado en el entorno que resuelva el
problema sin necesidad de código ni credenciales propias. Priorizar usar lo que
ya está conectado antes de construir infraestructura nueva.

## 2026-07-14 — Retipear eventos a mano hizo perder una sesión real en el resumen

**Qué pasó:** Al probar el flujo del Hito 0 con datos reales, en vez de pasar
el array de eventos que devolvió el conector de Google Calendar tal cual al
script de clasificación, lo retipeé a mano como una lista corta de títulos.
En esa transcripción manual se perdió una sesión real de "Pt Felipe y Javi"
(la del 15 de julio), y el resumen mostró 2 sesiones en vez de 3. Fernando lo
detectó porque conocía el dato real.

**Por qué pasó:** Se introdujo un paso manual (retipear/condensar la lista de
eventos de memoria) entre la fuente de verdad (el conector) y el script
determinista. Ese paso manual es exactamente el tipo de eslabón donde un
humano —o una IA reconstruyendo datos de memoria— puede perder información
sin darse cuenta.

**Qué se hace distinto a partir de ahora:** Nunca reconstruir de memoria una
lista de eventos/títulos para pasarla a un script. El array de eventos debe
ir del conector al script de clasificación sin transcripción manual
intermedia (guardarlo en un archivo o pasarlo directo). Si en algún punto no
es posible evitar un paso manual, decirlo explícitamente y pedir que el
usuario verifique el resultado antes de darlo por bueno.

## 2026-07-15 — El conector de Google Drive no permite escribir/actualizar archivos existentes

**Qué pasó:** Al planear guardar la base de datos de clientes en Google
Sheets, se comprobó qué herramientas ofrece el conector de Google Drive ya
disponible. Solo permite crear archivos nuevos (`create_file`), copiarlos
(`copy_file`) y leer contenido (`read_file_content`, `download_file_content`)
— no hay ninguna herramienta para actualizar celdas o filas de una hoja ya
existente.

**Por qué pasó:** Se asumió que "ya hay un conector de Google conectado"
significaba que se podía leer y escribir igual que con Calendar, sin
comprobar qué operaciones concretas expone cada conector.

**Qué se hace distinto a partir de ahora:** Antes de diseñar un flujo que
necesite escribir datos, comprobar explícitamente (con ToolSearch) qué
operaciones de escritura existen realmente para ese conector en concreto —
"está conectado" no implica "se puede escribir ahí". Si la escritura no está
disponible, preferir una alternativa simple bajo control total (como un
archivo local) antes que montar una autenticación propia solo para poder
escribir.

## 2026-07-15 — Intenté derivar la tarifa del color del evento, cuando el dato ya vive en la base de datos

**Qué pasó:** Fernando compartió un documento detallado de tarifas donde se
menciona que los colores de Google Calendar identifican la tarifa. Empecé a
diseñar cómo mapear los colores exactos de Google (Uva, Albahaca, Plátano...)
a las tarifas de Fernando, e iba a pedirle que confirmara ese mapeo color por
color. Fernando aclaró que no hace falta: el color es solo orientativo para
él en su propio calendario; el sistema debe relacionar el nombre del cliente
detectado en Calendar con la tarifa que ya está guardada en
`datos/clientes.xlsx` — que es justo lo que `programas/procesar.py` ya hace.

**Por qué pasó:** Al leer el documento de tarifas asumí que había que extraer
un dato (la tarifa) de una señal secundaria (el color) en vez de comprobar
primero si ese dato ya existía en la fuente de verdad que ya se había
construido (el Excel de clientes).

**Qué se hace distinto a partir de ahora:** Antes de diseñar cómo extraer un
dato desde una fuente nueva (colores, texto libre, etc.), comprobar si ese
dato ya vive en una fuente de verdad existente y más simple. No añadir una
vía de lectura adicional para algo que ya se resuelve con lo que hay.

## 2026-07-15 — Abrir y guardar el Excel con openpyxl borra los valores ya calculados de las fórmulas, y a veces también los desplegables

**Qué pasó:** Al renombrar una columna y reponer un desplegable con
`load_workbook` + `wb.save()` (sin `data_only`), se perdieron dos cosas sin
querer: (1) el desplegable de "Tipo de programa" — Excel a veces lo guarda
en un formato "extendido" que openpyxl no lee y descarta con un aviso
("Data Validation extension is not supported and will be removed"); y (2)
los valores ya calculados de las fórmulas de tarifa/sesiones (openpyxl solo
conserva el texto de la fórmula, no el resultado cacheado, así que hasta que
Excel no la recalcule y guarde de nuevo, `data_only=True` devuelve `None`).

**Por qué pasó:** No se tuvo en cuenta que openpyxl no es un motor de
cálculo de Excel: cualquier apertura+guardado con esta librería es
potencialmente destructivo para fórmulas y para validaciones en formato
extendido, aunque el archivo "se vea bien" al inspeccionarlo con la propia
librería.

**Qué se hace distinto a partir de ahora:** `clientes/repositorio.py` ahora
repone los desplegables automáticamente antes de cada guardado
(`_asegurar_validaciones`). Además: evitar guardados innecesarios o
repetidos del mismo archivo con openpyxl en una misma sesión de trabajo
(agrupar los cambios en un solo guardado), y avisar a Fernando de que debe
abrir y guardar el Excel en Excel de verdad (Ctrl+S) después de cualquier
cambio hecho por el sistema, para que las fórmulas queden recalculadas y
cacheadas.
