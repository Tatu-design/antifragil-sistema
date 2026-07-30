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
En esa transcripción manual se perdió una sesión real de "Pt Pareja C"
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

## 2026-07-15 — `stdin`/`stdout` no son UTF-8 por defecto en este Windows, y corrompían nombres con tildes

**Qué pasó:** Al construir `cierre_semanal/cli.py` (que cruza los nombres
detectados en Calendar contra los nombres del Excel), "Clienta Ángela" aparecía
sistemáticamente como "sin programa" aunque su fila en el Excel estaba
completa. Al investigar, `sys.stdin.encoding` resultó ser `cp1252`, no
UTF-8: al leer el JSON de eventos por `stdin` (redirigido con `<` desde un
archivo UTF-8), la "í" (dos bytes en UTF-8: `0xC3 0xAD`) se decodificaba mal
como dos caracteres distintos en cp1252, generando un "Clienta Ángela" con bytes
distintos al leído por `openpyxl` (que sí usa UTF-8 correctamente) — dos
strings que se ven idénticos al imprimirlos pero que no son iguales para
Python. Los nombres sin tildes (Cliente A, Ana, Cliente B...) nunca mostraron el
problema, lo que lo hizo parecer al principio una condición de carrera.

**Por qué pasó:** Se asumió que `sys.stdin.read()`/`print()` usan UTF-8 por
defecto. En este Windows no es así — dependen de la página de códigos de la
consola.

**Qué se hace distinto a partir de ahora:** Todo script que lea o escriba
texto por `stdin`/`stdout` debe forzar explícitamente
`sys.stdin.reconfigure(encoding="utf-8")` /
`sys.stdout.reconfigure(encoding="utf-8")` al principio de `main()`. Si un
cruce de nombres falla de forma que "no debería poder fallar" (los datos
están ahí, están bien escritos), sospechar primero de la codificación en
los bordes de entrada/salida antes de asumir un error de lógica o una
condición de carrera.

## 2026-07-16 — Guardar desde la web app borró tarifa/sesiones de todos los clientes, no solo del editado

**Qué pasó:** Al probar de punta a punta el primer formulario de edición de
la web app (paso 2 del proyecto de aprendizaje Flask), tras guardar el
cambio de un cliente, `leer_clientes()` devolvió `tarifa` y
`sesiones_totales` en `None` para **todos** los clientes, no solo el
editado. Ya se sabía (lección del 2026-07-15) que openpyxl borra el valor
cacheado de las fórmulas al guardar, pero hasta ahora ese problema era
puntual (una escritura ocasional desde el cierre semanal); con la web app
la escritura pasa a ser mucho más frecuente, así que la fricción de "avisa
a Fernando que reabra Excel" se volvía real y constante.

**Por qué pasó:** Se aceptó la limitación de openpyxl como algo a
comunicar, en vez de preguntarse si se podía evitar por completo.

**Qué se hace distinto a partir de ahora:** `leer_clientes()` ahora
recalcula tarifa/sesiones_totales en Python (contra la hoja "Programas",
que son valores literales, no fórmulas) cuando el valor cacheado del Excel
viene vacío — el sistema deja de depender de que Fernando reabra y guarde
el Excel. Lección general: cuando una limitación de una librería se puede
evitar recalculando el resultado por nuestra cuenta con datos que ya
tenemos, hacerlo — no limitarse a documentar la limitación y pedirle al
usuario que la compense a mano.

## 2026-07-18 — Migración completa de Excel a SQLite, secuenciada por riesgo real

**Qué pasó:** Fernando pidió poder crear/editar clientes desde la web app
de aprendizaje sin tocar Excel. Al construirlo con SQLite en un módulo
aparte (`webapp/db.py`), se hizo evidente que mantener dos copias de los
datos (Excel para el negocio real, SQLite para la web) era exactamente el
tipo de complejidad frágil que este proyecto evita — así que Fernando
decidió migrar **todo el sistema real** a SQLite, no solo la web.

La secuencia se decidió por riesgo, no por calendario: como el domingo 19
de julio era el primer cierre semanal real, la primera propuesta fue
esperar al lunes para migrar. Pero Fernando aclaró que ese cierre era "solo
una comprobación" y que avanzar rápido era la prioridad — así que la
migración completa se adelantó al sábado 18, con margen de sobra para
probarla a fondo (migración de datos reales, `cierre_semanal previsualizar`
y `aplicar` en una copia, web app completa) antes de que llegara el cierre
real del domingo.

**Por qué pasó:** La decisión inicial de "esperar al lunes" fue prudente
pero se ancló al calendario (día de la semana) en vez de a la condición de
riesgo real (¿ha quedado esto probado a fondo con margen antes del primer
uso real?). En cuanto Fernando aclaró que el cierre del domingo no era tan
crítico como se asumió, la condición real ya no exigía esperar.

**Qué se hace distinto a partir de ahora:** Cuando se decida posponer un
cambio arriesgado "hasta tal día", identificar y decir en voz alta cuál es
la condición de riesgo real detrás de esa fecha (aquí: "tener tiempo de
sobra para probarlo antes del primer uso real"). Si esa condición se puede
cumplir antes, no hace falta esperar al día que se dijo al principio —
pero solo tras confirmar explícitamente con el usuario que el contexto ha
cambiado, no unilateralmente.

## 2026-07-28 — `PRAGMA defer_foreign_keys` no basta por sí solo: hace falta abrir la transacción a mano primero

**Qué pasó:** Al arreglar el renombrado de un cliente con historial (que
violaba la clave foránea porque `clientes.nombre` cambiaba antes de que
`historial_sesiones.cliente` se actualizara a juego), añadí
`conexion.execute("PRAGMA defer_foreign_keys = ON")` justo antes de los dos
`UPDATE`. Seguía fallando con el mismo `IntegrityError`, incluso habiendo
comprobado con `PRAGMA defer_foreign_keys` que el valor se había puesto a 1
justo después de activarlo.

**Por qué pasó:** El valor de `defer_foreign_keys` solo se respeta DENTRO
de una transacción ya abierta. Python (`sqlite3`, modo de aislamiento por
defecto) no abre una transacción implícita hasta la primera sentencia
`INSERT`/`UPDATE`/`DELETE` — los `SELECT` y `PRAGMA` anteriores (las
comprobaciones de validación, en este caso) se ejecutan cada uno como su
propia mini-transacción autocommit, y `defer_foreign_keys` vuelve a su
valor por defecto (desactivado) en cuanto esa mini-transacción termina.
Para cuando llegaban los `UPDATE`, el aplazamiento ya se había perdido en
silencio — sin ningún error visible hasta el `UPDATE` que de verdad rompía
la referencia.

**Qué se hace distinto a partir de ahora:** Si hace falta aplazar
comprobaciones de clave foránea dentro de una operación con varias
sentencias, abrir la transacción explícitamente con
`conexion.execute("BEGIN")` ANTES de `PRAGMA defer_foreign_keys = ON`, y
comprobarlo con una prueba real (no solo leyendo el valor del pragma justo
después de activarlo) — un valor de pragma que "parece" puesto no garantiza
que siga vigente unas sentencias más adelante.

## 2026-07-28 — Un test que reproduce el bug exacto encontró un fallo real que la revisión de código no vio

**Qué pasó:** Al añadir `ciclo_bono` para solucionar el bug de renovación
que describió Fernando (borrar la sesión 1 de un bono nuevo no debía hacer
que el contador volviera a mostrar el número del bono anterior), escribí
la lógica, la revisé, y parecía correcta. El test que reproducía el
escenario EXACTO que Fernando describió (no un caso genérico) falló: el
contador volvía a poner 0 en vez de 11 al borrar la sesión que completaba
el bono anterior — un caso relacionado pero distinto al que motivó el
cambio, que la revisión manual no había cubierto.

**Por qué pasó:** El código revertía el estado de "pendiente de pago" al
deshacer una renovación, pero no revertía el `ciclo_bono` del cliente antes
de recalcular las sesiones completadas — el recálculo miraba el ciclo
nuevo (ya vacío tras el borrado) en vez del ciclo anterior. Una revisión de
código centrada en "¿la lógica tiene sentido?" no sustituye a ejecutar el
caso concreto que se está arreglando.

**Qué se hace distinto a partir de ahora:** Para cualquier corrección de un
bug con pasos de reproducción concretos (como los que dio Fernando en este
sprint), escribir el test que reproduce ese escenario EXACTO antes de darlo
por arreglado, y ejecutarlo — no basta con que el código "se lea bien". Esto
ya evitó declarar como resuelto un arreglo que en realidad tenía un caso
relacionado sin cubrir.
