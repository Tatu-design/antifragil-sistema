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
