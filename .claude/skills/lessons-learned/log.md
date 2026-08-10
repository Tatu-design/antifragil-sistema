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

## 2026-08-01 — Extraer los colores de un diseño no es portarlo: hay que medir contra el archivo original

**Qué pasó:** Fernando trajo un rediseño completo hecho con una herramienta
de diseño, con su código. Saqué de él la paleta, la tipografía y las
medidas, y las apliqué sobre la estructura HTML que ya tenía la app. Su
respuesta: *"no ha quedado exactamente igual, te has inventado muchas
cosas"*. Al medir contra su archivo aparecieron desviaciones objetivas: usé
`#e7e5e0` (el gris del lienzo del editor, donde flota el marco del móvil)
como fondo de la app en vez de `#F5F7F4`, que era el real; 480px de ancho en
vez de 430; una barra de navegación arriba en vez de su barra de pestañas
abajo; mi propia escala tipográfica en rem en vez de la suya en píxeles
fijos. Y después, ya corregido eso, todavía quedaba una lista de clientes en
dos columnas que él nunca pidió: su diseño no tiene ningún punto de ruptura
por ancho de pantalla.

**Por qué pasó:** confundí "aplicar el sistema visual" con "reconstruirlo a
partir de sus ingredientes". Los ingredientes eran suyos, la composición era
mía. Además tomé el color equivocado por no distinguir entre el lienzo del
editor y la pantalla de la app dentro del marco.

**Qué se hace distinto a partir de ahora:** cuando llegue un diseño con
código, portarlo componente a componente **leyendo los valores del propio
archivo** (fondo, anchos, radios, sombras, escala, estructura de la
navegación), no derivándolos. Antes de dar nada por bueno, hacer una tabla
"lo que dice su archivo / lo que he puesto yo" y revisar las diferencias una
a una — eso fue lo que destapó los fallos, y solo cuando lo hice dejé de
adivinar. Y ante un "no es igual", pedir que señale lo concreto o medirlo,
nunca reinterpretar por segunda vez.

## 2026-08-01 — Un efecto visual caro sobre un elemento fijo se paga en cada fotograma

**Qué pasó:** tras aplicar el rediseño, Fernando reportó la app "muy muy
lenta". Medí antes de tocar: el servidor respondía en ~0,5 s y las consultas
tardaban 1-2 ms, así que no era el servidor. El problema era `backdrop-filter`
(el desenfoque del fondo) puesto en **13 elementos a la vez** de la portada.
Lo quité de todo lo que hace scroll y seguía pesado: quedaba lo peor, en la
barra inferior, que es **fija y está siempre en pantalla** — llevaba a la vez
un `filter: blur(28px)` y un `backdrop-filter: blur(26px) saturate(210%)
brightness(1.04)`, recalculados en cada fotograma del scroll.

**Por qué pasó:** apliqué los efectos del diseño literalmente, sin pensar en
cuántos elementos los llevarían a la vez ni en cuáles estarían siempre
visibles. Una maqueta enseña una pantalla quieta; la app tiene una lista que
se desplaza.

**Qué se hace distinto a partir de ahora:** `backdrop-filter` y `filter:
blur` solo donde el efecto se aprecia de verdad y sobre pocos elementos —
nunca en algo que se repite por cada fila de una lista, y con especial
cuidado en elementos `position: fixed`, que están en pantalla todo el rato.
Cuando el diseño los pida en más sitios, conseguir el mismo aspecto sin
coste: un fondo algo más opaco, o un degradado dibujado ya difuminado en vez
de desenfocar una capa. Y ante una queja de lentitud, medir primero servidor
y consultas para no optimizar el sitio equivocado.

## 2026-08-01 — Entregué dos veces un cambio que empeoraba la app sin saberlo

**Qué pasó:** al aplicar el rediseño dejé 13 elementos desenfocando el
fondo a la vez y la app se volvió lenta; Fernando tuvo que reportarlo.
Después, al arreglar la señal de carga, subí el script a la cabecera y le
quité el `defer`, con lo que el navegador dejaba de dibujar la página hasta
descargarlo — y otra vez tuvo que ser él quien dijera "va especialmente
lenta". Su corrección: *"no puede ser que hagas algo que hace peor el
manejo de la app y no lo sepas, y sobre todo que no lo optimices antes de
entregar el trabajo"*.

**Por qué pasó:** antes de entregar comprobaba dos cosas —que funcionara y
que las 74 pruebas pasaran— pero nunca que siguiera yendo igual de rápido.
El rendimiento solo se medía cuando alguien se quejaba, y para entonces ya
estaba en producción. Las pruebas automáticas no detectan esto: un
`backdrop-filter` de más o un `<script>` que bloquea el dibujado no rompen
ningún test.

**Qué se hace distinto a partir de ahora:** existe
`comprobar_rendimiento.py`, que mide lo que las pruebas no ven —recursos que
bloquean el dibujado, efectos caros del CSS, peso de lo que se descarga,
conexiones a la base de datos por pantalla— y falla si algo se pasa de los
límites. **Se ejecuta antes de dar por terminado cualquier cambio que toque
plantillas, CSS, JavaScript o consultas**, igual que se ejecutan las
pruebas. Si un cambio empeora una cifra, o se corrige antes de entregar o se
dice explícitamente por qué compensa — pero nunca se entrega sin saberlo.

---

## 2026-08-02 — Una medición que ya no medía lo que decía medir

**Qué pasó:** al reorganizar la ficha del cliente,
`comprobar_rendimiento.py` seguía dando el visto bueno al perfil… pero
estaba simulando la versión **antigua** de la pantalla: llamaba a consultas
que la ruta real ya no hacía. El número era verde y no significaba nada.

**Por qué pasó:** la puerta de rendimiento se escribió imitando a mano lo
que hacía cada pantalla, en vez de ejecutar la pantalla de verdad. Esa
imitación envejece en cuanto se toca la ruta, y no hay nada que avise —
ninguna prueba falla porque una simulación se quede desfasada.

**Qué se hace distinto a partir de ahora:** cuando se cambien las consultas
de una ruta, se actualiza en el mismo cambio lo que
`comprobar_rendimiento.py` simula de esa ruta. Y en general: una medición
que no se revisa junto al código que mide es peor que no tener medición,
porque da falsa tranquilidad.

---

## 2026-08-02 — Sintaxis de PowerShell dentro de la herramienta Bash

**Qué pasó:** dos commits quedaron con un `@` colgando al principio del
título (`@ feat(perfil): …`). Escribí el mensaje con `-m @'…'@`, que es un
*here-string* de PowerShell, dentro de la herramienta Bash — donde ese `@`
es simplemente el primer carácter del mensaje.

**Por qué pasó:** en este proyecto conviven dos intérpretes (PowerShell y
Bash) y mezclé la sintaxis de uno con la herramienta del otro. Además no
comprobé el resultado: `git commit` no falla por esto, así que pasó
inadvertido hasta mirar `git log`.

**Qué se hace distinto a partir de ahora:** mensajes de varias líneas en
Bash con `-F -` y un heredoc `<<'FIN'`, nunca con `@'…'@`. Y **mirar
`git log --oneline` después de commitear**, que es un segundo y evita
arrastrar el error a algo que ya no se puede corregir sin `push --force`
(prohibido). Los dos commits se quedan como están: reescribir historia ya
publicada por un carácter cosmético sale mucho más caro que el defecto.

---

## 2026-08-03 — Las pruebas de lógica no ven lo que ve la pantalla

**Qué pasó:** el motor de las tres modalidades pasó 144 pruebas en verde y
la economía cuadraba al céntimo. Al dibujar la ficha por primera vez
aparecieron **tres fallos de golpe** que ninguna prueba había tocado:
`configurar_servicio` hacía un `UPDATE` sobre una fila que podía no existir
(se guardaba en silencio nada), las sesiones completadas se calculaban con
el total de la lista global en vez del ciclo (contadores negativos, «-9 de 8
sesiones»), y la función que prepara los datos para la plantilla copia
claves una a una y descartaba las nuevas, así que el precio del bono
desaparecía sin error.

**Por qué pasó:** las pruebas comprobaban las funciones por separado —
guardar, firmar, calcular— pero ninguna recorría el camino entero *hasta el
HTML*. Los tres fallos viven justo en las costuras: entre guardar y leer,
entre el ciclo y la lista global, entre el diccionario del repositorio y el
de la plantilla. Ninguno lanza excepción; los tres fallan callados.

**Qué se hace distinto a partir de ahora:** cuando una funcionalidad tenga
pantalla, **una de las pruebas pide la página y comprueba el texto que sale**
(ver `TestPantallaPorModalidad` en `tests/test_tres_modalidades.py`), no solo
que las funciones devuelvan lo correcto. Y en general: desconfiar de
`UPDATE ... WHERE` cuando la fila puede no existir todavía — casi siempre
lo que se quiere es `INSERT ... ON CONFLICT DO UPDATE`, que funciona en los
dos casos.

---

## 2026-08-04 — Una condición de plantilla que borró una funcionalidad entera

**Qué pasó:** entregué las tres modalidades con 198 pruebas en verde y la
economía cuadrando al céntimo. Fernando abrió la app y **el botón «Firmar
sesión» no estaba en mensualidad ni en cuenta de cliente**. Es decir:
entregué una funcionalidad que no se podía usar en dos de sus tres casos.

**Por qué pasó:** la plantilla decidía con
`{% if cliente.sesiones_totales and puede_firmar %}`. En las dos modalidades
nuevas ese valor es 0 —justamente porque no consumen saldo— y 0 es falso.
La condición era un resto de cuando solo existían bonos, y al añadir las
modalidades no la revisé: comprobé que el motor calculaba bien, no que la
pantalla dejara operar. Detrás había algo peor que no vi: la ficha leía de
dos fuentes a la vez (los campos heredados del cliente y el ciclo en curso),
así que podían contradecirse en silencio.

**Qué se hace distinto a partir de ahora:**

1. **Cuando un cambio añade casos nuevos a algo que ya existía, hay que
   releer TODAS las condiciones que decidían el comportamiento anterior.**
   Cada `{% if %}` escrito cuando solo había un caso es un candidato a
   excluir los casos nuevos, y no lanza ningún error al hacerlo.
2. **Una pantalla, una fuente.** Si los datos pueden venir de dos sitios, se
   construye una única estructura antes de renderizar (aquí,
   `ficha_servicio()`) y la plantilla no decide nada. Dos fuentes acaban
   discrepando siempre, y la discrepancia no falla: solo enseña lo que no es.
3. Y la lección del 2026-08-03 llevada al extremo que le faltaba: la prueba
   de interfaz no basta con que compruebe lo que SE VE — tiene que comprobar
   también **que lo que hay que poder hacer se puede hacer**, caso a caso.
   Ahora `tests/test_ficha_interfaz.py` verifica la presencia del botón en
   las tres modalidades y su ausencia en los tres estados bloqueantes.

---

## 2026-08-04 — Reescribir una interfaz "equivalente" no es portarla

**Qué pasó:** entregué la aplicación en Next.js con las reglas de negocio
comprobadas al céntimo y los datos migrados sin una sola diferencia, y
Fernando tuvo que decírmelo: la pantalla estaba **visual y operativamente
lejos** de la que él usa todos los días. Otros colores de acento no; peor:
otra disposición, otros textos, otro orden de la información y botones que
no estaban donde su mano ya sabe que están.

**Por qué pasó:** construí la interfaz nueva desde mi descripción de la
antigua en vez de desde sus archivos. Leí las plantillas para entender qué
hacía cada pantalla, y luego escribí una pantalla que hacía lo mismo. Eso
no es portar: es rehacer. Es exactamente la lección del 2026-08-01
("extraer los colores de un diseño no es portarlo: hay que medir contra el
archivo original") aplicada a la estructura en vez de al color, y no la
reconocí porque esta vez el archivo original era una plantilla y no una
paleta.

**Qué se hace distinto a partir de ahora:**

1. **Portar una pantalla es copiar su marcado, no describirlo.** Se abre la
   plantilla original al lado y se van trasladando sus clases, su orden y
   sus textos uno a uno. Si al terminar hay una clase CSS que la original
   tenía y la nueva no, es una diferencia que hay que justificar, no un
   detalle.
2. **La hoja de estilos se copia, no se reinterpreta.** `public/style.css`
   es literalmente `webapp/static/style.css`. Un sistema de diseño nuevo
   (Tailwind, en este caso) que produce "lo mismo pero parecido" produce
   exactamente el problema que Fernando encontró.
3. **Una comprobación por HTTP real de cada pantalla**, que verifica que
   salen las mismas clases y los mismos textos que la plantilla original.
   Las 131 pruebas y el build pasaban con la interfaz equivocada: nada de
   lo que medía miraba la pantalla.
4. **Y comprobar también los archivos que la pantalla necesita.** El
   recorrido inicial pedía el HTML del login y lo daba por bueno; el
   middleware estaba redirigiendo `/style.css` y las fuentes al login por
   no llevar cookie, así que la pantalla de entrada habría salido sin un
   solo estilo. Una pantalla no está bien porque su HTML esté bien.

---

## 2026-08-04 (bis) — Un GET que cambia algo no sobrevive a un navegador listo

**Qué pasó:** Fernando entró en la app y le pedía la contraseña **en cada
pantalla**. No era un fallo de la sesión ni de la cookie: era el chip
«Salir» de la cabecera.

**Por qué pasó:** copié el `/logout` de Flask tal cual —un enlace normal a
una dirección que cierra la sesión— y lo puse en un `<Link>` de Next. Next
**precarga** los enlaces que están a la vista para que la navegación sea
instantánea, y «Salir» está en la cabecera de todas las pantallas. Así que
abrir cualquier página disparaba sola una petición a `/salir` y le cerraba
la sesión antes de que pudiera hacer nada. En Flask el mismo diseño
funciona porque un `<a>` de HTML no se adelanta.

**Qué se hace distinto a partir de ahora:**

1. **Al portar una ruta, portar también sus supuestos.** «Un enlace solo se
   pide si alguien lo pulsa» era cierto en Flask y dejó de serlo en Next.
   Copiar el marcado no basta: hay que preguntarse qué daba por hecho el
   original y si sigue siendo verdad en el sitio nuevo.
2. **Nada que cambie el estado se cuelga de un GET que otro pueda pedir por
   su cuenta.** Si tiene que ser un GET por parecerse al original, la ruta
   distingue una visita de verdad de una precarga y solo actúa en la
   primera.
3. **El comprobador de pantallas vive en el repositorio**
   (`npm run comprobar:pantallas`) y ahora también verifica esto: que
   precargar «Salir» no cierre la sesión y que pulsarlo sí. Los dos fallos
   de hoy —este y la hoja de estilos bloqueada por el middleware— eran
   invisibles para las 131 pruebas, para los tipos y para el build.

---

## 2026-08-04 (2) — Un contador que medía la etiqueta, no la cantidad

**Qué pasó:** Fernando borró una sesión del historial de un cliente y el
marcador principal siguió igual. La ficha decía «7 de 8» y su propio
historial, dos centímetros más abajo, enseñaba 6 sesiones.

**Por qué pasó:** el contador de sesiones consumidas se calculaba como *el
número de la última sesión que queda*, no como *cuántas sesiones hay*.
Mientras solo se borrara la última, las dos cosas coincidían y nadie lo
notaba. Al borrar una del medio o la primera, dejaban de coincidir. Es un
error de modelo, no de código: se estaba midiendo la **etiqueta** de un
elemento en vez de la **cantidad** del conjunto.

**Lo que lo hizo peor:** al buscar el descuadre en los datos reales del
servidor aparecieron otros dos que llevaban semanas ahí (un cliente con
huecos y contador 0, otro con 9 sesiones en un bono de 8). Nadie los había
visto porque **ninguna pantalla comparaba las dos cifras entre sí**.

**Qué se hace distinto a partir de ahora:**

1. **Cuando dos sitios de la pantalla muestran la misma realidad, hay que
   probar que coinciden**, no solo que cada uno es correcto por su lado. La
   prueba `test_la_ficha_y_su_historial_nunca_se_contradicen` borra sesiones
   en bucle y comprueba en cada paso que el marcador y el historial dicen lo
   mismo. Ese tipo de prueba habría cazado esto el primer día.
2. **Desconfiar de un valor derivado que se calcula de una forma distinta a
   como se lee.** Si la pantalla cuenta filas y el modelo guarda un número
   máximo, van a divergir tarde o temprano.
3. Antes de arreglar datos reales, **descargar una copia del servidor y
   auditarla**: el fallo que Fernando reportó era uno de tres, y los otros
   dos no se habrían encontrado mirando solo el caso descrito.

---

## 2026-08-05 — Subir un SQLite en modo WAL sin volcar el registro

**Qué pasó:** corregí una fila en una copia de la base de producción, la subí
al servidor, recargué… y el cambio no estaba. La base seguía como antes.

**Por qué pasó:** la base va en modo WAL. El `UPDATE` no se escribe en
`antifragil.db`, sino en `antifragil.db-wal`, y solo pasa al archivo principal
cuando SQLite hace un "checkpoint". Subí el `.db` **antes** de que eso
ocurriera, así que subí el archivo con el valor viejo. Curiosamente, al abrir
después la copia en local el checkpoint sí se hizo y el archivo mostraba el
valor nuevo — lo que hacía parecer que la subida había funcionado.

Es doblemente irónico porque el propio `basedatos.py` documenta esta trampa:
por eso pone `wal_autocheckpoint = 1`. Pero ese ajuste vive **dentro de la
base**, y una copia manipulada con una conexión suelta puede quedarse con
cambios pendientes igualmente.

**Qué se hace distinto a partir de ahora:** antes de subir cualquier archivo
SQLite manipulado, **cerrar la conexión y forzar
`PRAGMA wal_checkpoint(TRUNCATE)`**, y comprobar que no quedan `-wal` ni
`-shm` al lado. Y después de subir, **volver a descargar y verificar el valor**
— no dar por bueno un `200` de la subida.

---

## 2026-08-05 — «Nuevo» no es lo mismo que «modificado»

**Qué pasó:** al aplicar la regla «todo servicio nuevo nace pendiente de pago»
puse el `0` en la rama equivocada: la que **corrige** las condiciones de un
servicio existente, no la que **abre** uno nuevo. Resultado: cambiar el precio
de un bono ya cobrado lo reabría como deuda. Lo cazó una prueba que yo mismo
acababa de escribir.

**Por qué pasó:** las dos ramas hacen un `INSERT INTO programas_cliente` casi
idéntico y se parecen mucho leyéndolas por encima. Edité por coincidencia de
texto en vez de por significado.

**Qué se hace distinto a partir de ahora:** cuando una regla distingue entre
«crear» y «modificar», escribir primero la prueba de las DOS caras —lo que
debe cambiar y lo que debe quedarse igual— antes de tocar el código. La cara
que se queda igual es la que se olvida, y es la que rompe cosas que
funcionaban.

---

## 2026-08-05 (2) — Diagnostiqué la aplicación equivocada

**Qué pasó:** Fernando dijo «va muy muy lenta la app». Me puse a medir y
optimizar la de Flask. No era esa: hablaba de la de Vercel, la única que usa
ya. Perdí un buen rato midiendo donde no dolía, y tuvo que pararme él.

**Por qué pasó:** el síntoma encajaba en las dos aplicaciones y elegí por
costumbre, no por comprobación. Llevo semanas trabajando en Flask y el dedo
fue solo.

**Qué se hace distinto:** queda escrito en `.claude/CLAUDE.md` y en la memoria
del proyecto: **cuando Fernando dice «la app», es siempre la de Vercel.** Ante
cualquier síntoma, reproducirlo primero ahí. Si de verdad hay duda, se
pregunta en una línea antes de investigar — cuesta menos que media hora
midiendo lo que no era.

---

## 2026-08-05 (3) — Lo caro no es la consulta, es el viaje

**Qué pasó:** la lista de clientes tardaba más de 7 segundos en Vercel. Cada
consulta suelta era rapidísima; el problema es que hacía **41**.

**Por qué pasó:** el código venía portado de Flask, donde la base es SQLite en
el mismo disco: una consulta cuesta microsegundos y pedir datos cliente a
cliente no se nota. En Vercel la base está en Supabase, al otro lado de la
red: **cada consulta cuesta ~180 ms**. El mismo bucle que en Flask era
gratis, aquí eran siete segundos.

Es el error de portar una arquitectura sin portar sus supuestos de coste.

**Qué se hace distinto:**

1. **Cargar en bloque, no por elemento.** La lista pasó de «una consulta por
   cliente» a tres consultas fijas que no crecen con el número de clientes.
2. **Lo que no depende de otra cosa, va en paralelo** (`Promise.all`). Cuatro
   consultas encadenadas son cuatro esperas; a la vez, una.
3. **Puerta de rendimiento** (`tests/rendimiento.test.ts`): cuenta los viajes
   a la base por pantalla y falla si alguna se pasa del presupuesto. Incluye
   una prueba que duplica los clientes y comprueba que el número NO sube —
   así, si alguien vuelve a meter una consulta por cliente, salta.

---

## 2026-08-09 — Escribí mal su nombre teniendo la prueba delante

**Qué pasó:** puse «Tato» como nombre del administrador en la base de datos y
en la documentación. Se llama **Tatu**.

**Por qué pasó:** el encargo escrito decía «Todos | Tato | Rafa», y lo copié
tal cual. Pero el repositorio lleva toda la sesión enseñando lo contrario: la
cuenta de Vercel es `tatu5` y el repositorio es `Tatu-design`. Tenía dos
pruebas a la vista de que el nombre real era otro y no las miré, porque el
texto del encargo parecía zanjar la cuestión.

**Qué se hace distinto:** un nombre propio que va a quedar escrito en la base
de datos y en una pantalla se contrasta con lo que dice el repositorio antes de
escribirlo. Si el encargo y los datos no coinciden, **se pregunta en una línea**
— no se elige el que viene en el texto por ser el más reciente. Un encargo
largo puede tener una errata; el nombre de la cuenta de alguien, no.

Vale para cualquier dato que identifique a una persona: nombre, correo, alias.

---

## 2026-08-10 — Mis pruebas daban verde con la pantalla de login

**Qué pasó:** desplegué el sistema de dos roles diciendo que estaba verificado.
Rafa **no podía entrar en absoluto**: su cuenta se guardó como
«Rafagalindo998@…» y la aplicación busca los correos en minúsculas, así que
no lo encontraba nunca. Lo detecté por casualidad, investigando por qué no le
salía un botón.

**Por qué pasó, que es lo grave:** mis quince comprobaciones de que «Rafa ve lo
que debe» estaban escritas **en negativo**: no ve clientes ajenos, no ve la
pestaña de Economía, no le llega ningún nombre. **La pantalla de login cumple
todas.** Estaba comprobando una pantalla de acceso creyendo que comprobaba la
lista de un entrenador, y todo salía verde.

Una comprobación que solo mira lo que NO aparece no distingue «funciona y está
protegido» de «no funciona en absoluto».

**Qué se hace distinto:**

1. **Toda comprobación en negativo va acompañada de una en positivo** que
   demuestre que se está mirando la pantalla correcta: el título esperado, un
   dato que solo aparezca ahí. Si la positiva falla, las negativas no valen.
2. Un correo electrónico se compara **siempre en minúsculas por los dos
   lados**, y se guarda normalizado. Hay una prueba que lo busca con
   mayúsculas, con minúsculas y con espacios.
3. Cuando una comprobación falle por algo que parece menor —un botón que no
   sale—, **mirar primero si la pantalla es la que se cree**, antes de tocar
   el botón.

---

## 2026-08-10 (2) — El repositorio real perdía una columna en silencio

**Qué pasó:** Fernando dio de alta a un cliente eligiendo a Rafa como
profesional. El cliente se creó **sin profesional ninguno** y no aparecía en la
lista de nadie. Lo encontró él, no yo, y encima justo después de que yo dijera
que estaba verificado.

**Por qué pasó:** el servicio ponía el dato en el objeto, pero la consulta
`insert into clientes (...)` no nombraba la columna. El `update` tampoco. Se
perdía sin dar ningún error.

**Por qué no lo vio ninguna prueba, que es lo importante:** las pruebas corren
contra el repositorio de staging, que **guarda el objeto entero en un
archivo**. Ahí un campo nuevo sobrevive solo, sin que nadie lo nombre. En
PostgreSQL hay que escribirlo columna por columna. Las dos implementaciones
tienen contratos idénticos y comportamientos distintos justo en esto.

Y las pruebas contra Supabase se saltan solas cuando detectan datos reales
—que es lo correcto—, así que tampoco iban a cazarlo nunca.

**Qué se hace distinto:**

1. Existe `tests/repositorio-coherente.test.ts`, que **lee el código fuente**
   y exige que toda columna que el repositorio sepa LEER la sepa también
   ESCRIBIR. Un campo que se lee y no se escribe siempre vale `null`: eso no
   es un dato, es un error esperando. Comprobado que falla al reintroducir el
   fallo a propósito.
2. **Al añadir un campo a una entidad, tocar SIEMPRE tres sitios en el
   repositorio de PostgreSQL**: la lectura, el `insert` y el `update`. Que el
   de staging funcione no demuestra nada sobre el real.
3. Antes de decir «verificado» sobre algo que escribe datos, comprobar el dato
   **en la base**, no solo que la pantalla no dé error.

