# ARQUITECTURA.md — Estado técnico actual

> Este documento refleja el estado real del proyecto, no el plan. Se actualiza
> cada vez que cambia algo técnico relevante.

## Estado actual

### Migración a Next.js/Supabase/Vercel — Fases 0 a 3 (2026-08-03)

Trabajo en `feat/migracion-next-vercel`, salida de `feat/modalidades-servicio`.
**La aplicación Flask de PythonAnywhere no se ha tocado en ningún momento** y
sigue siendo la oficial. Cero líneas modificadas del código de producción.

- **Fase 0**: copia de la base de datos verificada (`integrity_check` correcto,
  0 claves rotas), rama nueva, `main` y `feat/webapp-flask` intactas.
- **Fase 1**: `docs/MIGRACION_NEXT_AUDITORIA.md` — inventario de las 40 rutas,
  13 tablas y las reglas de negocio, con 12 riesgos.
- **Fase 2**: `docs/MIGRACION_NEXT_EQUIVALENCIA.md` — la matriz que hace de
  contrato: qué hace cada regla hoy, qué prueba lo demuestra y en qué estado está.
- **Fase 3**: **94 pruebas nuevas** (de 245 a **339**), en dos piezas:
  - `tests/fixtures/escenarios.json` — 38 escenarios descritos como **datos**,
    no como código, para que Python y la futura versión TypeScript ejecuten
    exactamente lo mismo. Los resultados esperados están **calculados a mano**
    desde las reglas de negocio, nunca capturados de la salida del sistema.
  - `tests/test_equivalencia_reglas.py` — 50 pruebas para lo que no cabe en un
    archivo de datos: autenticación, aislamiento del enlace público, las cuatro
    capas anti-duplicado (incluida la de dos hilos firmando a la vez),
    atomicidad ante un fallo provocado, y precisión de los importes.

**Corrección de partida importante:** el encargo señalaba `feat/webapp-flask`
como fuente de verdad y estaba **42 commits por detrás**. Ver decisión D-01 en
`docs/MIGRACION_NEXT_DECISIONES.md`.

**Dos hallazgos abiertos**, fijados como escenarios pero **sin corregir**, porque
cambian cifras que Fernando ya está mirando y la decisión es suya:

1. Las sesiones de una **mensualidad no suman horas en la vista semanal** (sí en
   la mensual): el precio medio por hora de la semana sale inflado (`E33`).
2. El ciclo de una mensualidad puede decir **«pagada» mientras su cuota del mes
   dice «sin cobrar»** (`E34`).

Rendimiento sin cambios: 106,7 KB en la primera visita, 0 elementos desenfocados
al hacer scroll, 3-4 conexiones por pantalla.


- Paso 1 construido: resumen semanal de sesiones vía skill `resumen-semanal`.
  Solo lectura, no escribe todavía en ningún sitio.
- Paso 2 construido: lógica de descuento/renovación de programas
  (`programas/logica.py`, `programas/procesar.py`) y base de datos de
  clientes. Probado de punta a punta con datos reales.
- Paso 3 construido: skill `cierre-semanal` (`cierre_semanal/cli.py`) une
  Calendar + programas + base de datos en un solo flujo, con modo
  "previsualizar" (no escribe) y modo "aplicar" (solo tras confirmación
  explícita de Fernando). Probado de punta a punta con datos reales.
- Paso 4 construido: cálculo económico semanal/mensual (`economia/`) —
  facturación por sesiones hechas (no por pagos recibidos), desglosada por
  tarifa, con horas totales y precio medio por hora, replicando la lógica
  de la hoja de cálculo que ya usaba Fernando. Consultable por semana o por
  mes (`economia/cli.py`). CrossFit Kids se factura por mensualidad: se
  cuenta en sesiones pero su importe se reparte hacia atrás sobre las
  semanas del mes en cuanto Fernando indica la facturación mensual total.

### Economía, reducida a una sola pregunta (2026-08-08)

«¿Cómo va mi producción económica cada mes?» Eso es todo lo que responde la
pantalla ahora. Tres cifras por mes —facturación, horas y € por hora— con el
mes en curso arriba y con más peso visual, y los anteriores debajo.

**Qué se ha quitado de la vista**, no de los datos: la sección semanal
completa, el desglose por modalidades, las cuotas, los ajustes con su motivo,
los párrafos explicativos sobre CrossFit Kids y el subtítulo. Todo eso
respondía a preguntas que no se estaban haciendo desde aquí. Los cálculos
internos siguen existiendo (`porModalidad`, `facturacionCuotas`, `ajustes`) y
siguen entrando en los totales; simplemente ya no se pintan.

**El mes en curso existe siempre**, aunque no haya nada firmado: se calcula
aparte de la lista de meses con actividad, así que el día 1 se ve su bloque en
cero en vez de un hueco. Sin horas, el € por hora es un guion — no un cero que
parezca un dato.

**Provisional en una palabra.** Cuando quedan clases de Kids sin facturar, sus
horas ya cuentan pero su dinero no, así que el precio medio saldría a la baja.
El mes lleva una etiqueta «Provisional» y el € por hora enseña un guion. Se
acabaron las cajas de aviso explicando Kids dentro de Economía: eso se gestiona
en la ficha de CrossFit Kids.

**Dos consultas menos por carga.** La pantalla pedía `listarSemanas` y
`contarClases` para pintar la sección semanal; al desaparecer esa sección, se
dejaron de pedir. Los dos métodos siguen en el repositorio porque la
comprobación de sincronización sí los usa. Medido contra Supabase: de 18 a 16
consultas y de 1.811 a 839 ms. El presupuesto de la puerta de rendimiento baja
de 8 a 5 llamadas al repositorio.

**Los meses no son pulsables todavía**, a propósito: el detalle de cada mes es
otra iteración, y una tarjeta que parece un botón y no lleva a ningún sitio es
peor que una que no lo parece.

Archivos: `app/economia/page.tsx` (reescrita), `components/MesEconomico.tsx`
(nuevo), `services/economia.ts`, `public/style.css`. Borrado
`components/Metricas.tsx`, que se quedó sin usar.

**Pruebas:** 240 en verde, 15 nuevas en `tests/pantalla-economia.test.ts`
—mes vacío, PT, PT + Lidomare, PT + Lidomare + Kids, Kids sin facturar y
facturado, meses anteriores ordenados, mes anterior provisional, y que la
pantalla no pide lo que ya no enseña.

### CrossFit Lidomare y Kids, en la lista de clientes (2026-08-08)

Fernando quería registrar TODO su trabajo desde la pantalla principal. Hasta
ahora las clases de CrossFit se firmaban en Economía, que es una pantalla de
consulta, y las sesiones de PT en la ficha de cada cliente. Dos sitios para lo
mismo.

**Por fuera son dos cuentas más de la lista. Por dentro no son clientes.**
Siguen viviendo en `clases_grupo`, que era y sigue siendo su única fuente de
verdad. No se han metido en `clientes`, no tienen bono, ni pendiente de pago,
ni estado, ni enlace público — meterlas ahí solo para que se vieran igual
habría sido crear un cliente falso con seis campos que no significan nada.

Aparecen únicamente en **Activos**: «pendiente de pago», «pausado» y
«cancelado» son estados de clientes de verdad. El contador de Activos las
suma, para que el número coincida con las tarjetas que se ven, y por eso el
filtro se llama «Activos» y no «Clientes activos».

**CrossFit Lidomare** es una cuenta de actividad pura: cada clase son 15 € y
una hora. Sin tope, sin renovación, sin deuda. Un mes 4 clases y otro 6.

**CrossFit Kids** se factura al final. Las 8 clases al mes son una
REFERENCIA, no un límite: si un mes salen 9, se firman las 9 y la ficha
enseña «9 de 8». El importe lo introduce Fernando cuando lo sabe, y el
sistema calcula a cuánto salió la hora dividiéndolo entre las clases reales.
Antes de guardar se enseña ese resultado, porque es el número que acabará en
Economía. Sin ninguna clase ese mes, se niega y explica por qué: no habría
entre qué repartir el dinero.

**No hay contador guardado en ninguna parte.** Las clases del mes se cuentan
filtrando `clases_grupo` por fecha, así que el 1 de septiembre empieza solo en
0 sin que nadie reinicie nada y agosto se queda intacto en su sitio.

**Nada se ha duplicado.** Firmar y deshacer llaman a `registrarClase` y
`deshacerClase`, que ya existían y ya dejaban la economía de la semana
cuadrada; guardar el importe llama a `guardarFacturacionKids`, que también
existía. Lo único nuevo es cómo se miran: el mes en curso, su historial y la
validación de que no se puede facturar un mes sin clases. Los botones se han
quitado de Economía: firmar en dos sitios distintos era pedir que un día se
contara dos veces.

**Cambio de criterio: las horas de Kids cuentan siempre.** Antes no entraban
en las horas del mes hasta conocer su facturación, para que el precio medio no
saliera hundido. El problema es que eso escondía trabajo real: una clase de
Kids es una hora trabajada, se sepa o no lo que se va a cobrar por ella.

La solución al precio medio no es esconder horas, es decir la verdad. Mientras
falte el importe, el mes queda marcado y `precioMedioFiable` es `false`:
Economía enseña un guion en lugar del número y explica que quedan clases de
Kids sin facturar. Priorizar el dato exacto sobre la apariencia, que es lo que
pedía el encargo.

**Se firma desde la ficha, no desde la lista.** Llegué a poner un botón de
firmar en cada tarjeta de la lista y estaba mal entendido: Fernando entra en
el cliente y firma ahí dentro, que es donde ve lo que está firmando. La lista
es para mirar y elegir. Revertido el mismo día.

**«Deshacer la última» se ha retirado.** Se sustituye por borrar la clase
concreta desde el historial, igual que con la sesión de un cliente: así se ve
cuál se está borrando y no depende de que sea la más reciente. El importe sale
de la semana en la misma operación, como hacía el deshacer.

Archivos: `domain/clases.ts` (reglas puras), `services/clases.ts` (lecturas y
validación), `app/clases/[tipo]/page.tsx` (una ficha para las dos),
`app/clases/kids/facturacion/page.tsx`, `components/AccionesClase.tsx`,
`components/FormularioFacturacionKids.tsx`, más los retoques en
`domain/economia.ts`, `components/ListaClientes.tsx`, `app/clientes/page.tsx`,
`app/economia/page.tsx` y los dos repositorios.

**Pruebas:** 220 en verde, 31 nuevas en `tests/clases.test.ts`. Incluyen el mes
sin clases, 8 de 8, 9 de 8 sin bloquear, deshacer, el cambio de mes, facturar
con 7, 8 y 9 clases, el intento de facturar sin ninguna, y la comprobación de
que horas y facturación totales son la suma de PT + Lidomare + Kids. La puerta
de rendimiento vigila también estas pantallas.

### Borrar una sesión deja la cuenta cuadrada (2026-08-04)

Fernando borró una sesión de Paquito y el marcador principal no se movió: la
ficha decía «7 de 8» mientras su propio historial enseñaba 6 sesiones.

**La causa.** El contador del cliente se calculaba con el NÚMERO de la última
sesión que quedaba, no con cuántas sesiones había. Al borrar la nº 1 de 7, la
última seguía siendo la nº 7 → contador 7 con 6 sesiones, y un hueco en la
numeración.

**La corrección.** Al borrar una sesión, las posteriores del MISMO ciclo bajan
un número: si se borra la 3 de 7, las que eran 4..7 pasan a ser 3..6. El
contador baja con ellas. Se hace así, y no contando las filas a secas, para
respetar a un cliente que empezó a media —con sesiones hechas antes de entrar
en la app—: sus números arrancan más arriba y siguen bajando de uno en uno.

**La economía ya era correcta** y sigue siéndolo: borrar quita la hora y el
importe de esa sesión del mes al que pertenecía, y el precio medio se
recalcula solo. El número de sesión es una etiqueta y no entra en ningún
cálculo económico.

**`reparar_numeracion.py`** arregla lo que quedó descuadrado antes de esta
corrección. Corre al arrancar la web, es idempotente y solo toca la
numeración y el contador. Encontró tres casos en los datos reales:

| Cliente | Estaba | Queda |
|---|---|---|
| Paquito | números 2..7, contador 7 | 1..6, contador 6 |
| Nikki | 1..9 y 12,13,14 (huecos), contador 0 | 1..12, contador 12 |
| Rocío | 9 sesiones en un bono de 8, contador 1 | bono 1 cerrado con 8, bono 2 con 1 |

El caso de Rocío no era numeración: le faltó una renovación. Se reparte
aplicando la MISMA regla que usa la app al firmar (las sesiones que pasan del
tamaño del bono empiezan uno nuevo), no una invención del script. El bono que
se llena queda cerrado con la fecha de su última sesión; el cobro de los que
se cierran queda **sin marcar** — nunca se registró y no se supone si el
cliente pagó.

Verificado sobre una copia descargada del servidor: facturación, horas y
precio medio **idénticos** en los tres meses (agosto 755,00 €, julio
2.230,00 € / 53 h, junio 315,00 € / 9 h), mismas fechas y mismas tarifas
sesión a sesión, `integrity_check` correcto, 0 claves rotas y 0 sesiones
huérfanas. `tests/test_numeracion_sesiones.py` (20 pruebas) cubre borrar la
primera, una del medio, la última, varias seguidas, firmar después, y el
ajuste económico en las tres modalidades.

### Cobrar servicios ya cerrados y deudas en la lista (2026-08-04)

Dos huecos que encontró Fernando con el caso real de Samanta, que tenía una
cuenta de cliente del mes anterior a deber.

**1. El estado de cobro quedaba congelado al cerrar el ciclo.** Solo se
podía marcar el pago del servicio EN CURSO. Pero en el negocio real se paga
DESPUÉS: una cuenta de cliente se cobra al terminar el mes, y un bono puede
quedar a deber una vez agotado. Sin poder marcarlos, esas deudas no había
forma de saldarlas.

`marcar_pago_del_ciclo(cliente, pagado, ciclo=None)` acepta ahora cualquier
ciclo. Escribe en una sola transacción en todos los sitios donde vive ese
estado: el ciclo, el cargo del mes si es una mensualidad, y
`clientes.pendiente_pago` **solo si el ciclo es el que está en curso** — la
ficha del cliente habla del servicio de ahora, así que marcar un periodo
antiguo no la toca. En la pantalla, cada servicio del historial tiene su
propio control al desplegarlo (no en su cabecera: esa cabecera ya es un
botón y no puede contener otro).

**2. La lista de clientes no veía las deudas antiguas.** Contaba solo
`clientes.pendiente_pago`, que describe el ciclo en curso. Samanta, con
julio a deber y agosto al día, **no aparecía como pendiente de pago**.

`leer_clientes` devuelve ahora `ciclos_pendientes`: cuántos servicios YA
CERRADOS siguen sin cobrarse. La lista marca a un cliente como pendiente si
debe el actual **o** alguno anterior, y la tarjeta dice cuál es el caso
(«Pendiente», «2 sin cobrar», «Pendiente +1»). Se cuentan solo los ciclos
distintos del actual, porque el actual ya lo describe `pendiente_pago`: así
las dos fuentes no pueden contradecirse.

Un ciclo con `pagado` **nulo** no cuenta como deuda: de los servicios
anteriores a esta versión nunca se registró el pago y no se va a suponer. En
pantalla salen como «Sin marcar», y se pueden marcar cuando Fernando lo
sepa.

Nada de esto mueve la economía. `tests/test_cobro_historial.py` (19 pruebas)
comprueba que marcar y desmarcar el cobro tres veces seguidas deja
facturación, horas e historial exactamente iguales, en las tres modalidades.

### Corrección de la ficha: una sola fuente para la pantalla (2026-08-04)

Fernando probó las tres modalidades y encontró un fallo que ninguna de las
198 pruebas había detectado: **el botón «Firmar sesión» no aparecía en
mensualidad ni en cuenta de cliente**. Se podían configurar, pero no usar.

**La causa exacta.** La plantilla decidía así:

```
{% if cliente.sesiones_totales and puede_firmar %}
```

`sesiones_totales` vale 0 en mensualidad y en cuenta, precisamente porque no
consumen saldo — 0 es falso en una condición, así que el bloque entero
desaparecía. Y `puede_firmar` solo miraba el estado del cliente, no si su
servicio estaba completo.

**La causa de fondo era peor:** la ficha leía de DOS sitios a la vez, los
campos heredados de `clientes` y el ciclo en curso, y podían contradecirse.
El formulario guardaba correctamente el ciclo mientras la pantalla seguía
enseñando lo viejo.

**La corrección: `ficha_servicio()`.** Una única estructura de presentación,
construida desde el ciclo en curso, con todo lo que la pantalla necesita ya
resuelto — sesiones hechas y totales, restantes, barra y porcentaje, precios,
cuota, facturación, precio efectivo, periodo, etiqueta de pago, qué datos
faltan y si se puede firmar. La plantilla ya no decide nada ni consulta dos
fuentes: pinta lo que hay ahí. La usan la ficha de Fernando y el perfil
público del cliente, así que las dos pantallas no pueden discrepar.

**La regla nueva para firmar** (`puede_firmarse`), en la interfaz y en la
ruta POST, son tres condiciones y ninguna es "tener sesiones_totales":

1. El cliente está activo.
2. Tiene un ciclo en curso.
3. Ese ciclo tiene completos los datos que SU modalidad necesita — un bono,
   sesiones y precio; una mensualidad, cuota; una cuenta, precio por sesión.

Cuando falta algo, no se deja una pantalla muda: se dice qué falta
(«le falta la cuota mensual») y se enlaza a «Editar programa». El servidor
responde 409 con el mismo mensaje si alguien llama a la ruta a mano.

**Textos corregidos**, que decían cosas objetivamente falsas:

| Antes | Ahora |
|---|---|
| «sesión 3 de 0» en mensualidad y cuenta | «sesión 3 de agosto registrada» |
| «Acumulado» | «Total del mes» + el cálculo «3 sesiones × 35,00 € = 105,00 €» |
| «Programa pagado» para todo | «Bono pagado» / «Mensualidad pagada» / «Cuenta pagada» |
| «Su bono y su historial se conservan» | «Su servicio y su historial se conservan» |

Bajo «Total del mes» se aclara además que es lo **producido** en el periodo,
no necesariamente lo ya cobrado — era la duda concreta de Fernando.

**El pago ya no puede contradecirse.** `marcar_pago_del_ciclo` escribe el
estado de cobro en los tres sitios a la vez y en una sola transacción: la
ficha del cliente, su ciclo en curso y, si es una mensualidad, su cargo del
mes. Sigue sin tocar sesiones, horas, historial, facturación ni precio medio.

**Pruebas nuevas: `tests/test_ficha_interfaz.py`** (28). Piden la página y
comprueban el HTML real, no lo que devuelven las funciones — que es
exactamente lo que se le escapó a la tanda anterior. Cubren la presencia y
la ausencia del botón en las tres modalidades y en los tres estados, el
bloqueo por el servidor, los mensajes tras firmar, los textos de cada
tarjeta, que la pantalla refleje al momento un cambio de condiciones o de
modalidad, y los tres ejemplos económicos del encargo.

**226 pruebas en verde.**

### Tres modalidades de servicio: bono, mensualidad y cuenta (2026-08-03)

Hasta ahora todos los clientes funcionaban igual: un bono de N sesiones que
se consume y se renueva. Fernando necesitaba dos formas más de cobrar que ya
usa en la realidad.

**Las tres, en lenguaje llano:**

| | Cuándo se paga | Qué pasa al firmar | Cuándo se renueva |
|---|---|---|---|
| **Bono** | Por adelantado, un paquete | Descuenta una sesión y suma su parte | Al agotarse |
| **Mensualidad** | Cuota fija a principio de mes | Suma **hora**, no dinero | Al cambiar de mes |
| **Cuenta de cliente** | Al final, por lo hecho | Suma hora y su precio | Al cambiar de mes |

**La idea que mantiene esto simple:** una *cuenta de cliente* es
económicamente un bono sin tope — mismo camino de código, con
`sesiones_totales = 0` significando "sin límite" y sin renovación por
consumo. La única modalidad que estrena camino económico es la mensualidad.

**Cómo se resuelve la mensualidad sin ensuciar las horas.** Su cuota se
factura entera aunque se hagan 9, 12 o 13 sesiones. Se podría haber
inventado sesiones económicas ficticias para cuadrar; no se ha hecho, porque
mezclaría para siempre dos cosas que deben quedar separadas: el dinero
producido y las horas realmente trabajadas. En su lugar:

- Sus sesiones se guardan **sin importe** (`tarifa = NULL`): cuentan como
  hora trabajada y no suman dinero.
- La cuota vive en una tabla nueva, `cargos_mensuales`, con clave primaria
  `(cliente, año, mes, concepto)`. **Esa clave es lo que impide cobrar dos
  veces el mismo mes** — no lo impide el código que llama, lo impide la base
  de datos, aunque lleguen diez peticiones a la vez.
- El precio efectivo se calcula al vuelo: 720 € entre 12 son 60 €/h, entre 9
  son 80 €/h y entre 13 son 55,38 €/h. Sin sesiones no se muestra nada, para
  no enseñar una división por cero.

**Las condiciones dejan de depender de una lista global.** `programas_cliente`
gana `modalidad`, `precio_total`, `cuota_mensual`, `sesiones_referencia`,
`anio` y `mes` — todas opcionales y añadidas con `ALTER TABLE`, sin
reescribir una sola fila. El ciclo en curso pasa a ser la fuente de verdad de
tarifa, sesiones y cuota; la lista `programas` queda como atajo para dar de
alta un bono rápido.

**Dos trampas que aparecieron al hacerlo, y cómo se cerraron:**

1. `leer_clientes` hacía `JOIN programas`, no `LEFT JOIN`. Un cliente cuyo
   programa no estuviera en la lista global **desaparecía de la aplicación
   entera** — lista, ficha y economía. Con condiciones propias por cliente
   habría pasado constantemente. Ahora es `LEFT JOIN` y las condiciones se
   toman del ciclo.
2. `clientes.tipo_programa` tiene una clave foránea contra `programas`, así
   que ahí no cabe un nombre libre. La etiqueta del servicio pasa a vivir en
   el ciclo (que sí es libre) y esa columna se queda como puntero heredado,
   intacta cuando el nombre no está en la lista. Se eligió esto en vez de
   quitar la clave foránea porque eso obliga a reconstruir `clientes`, de la
   que cuelgan las claves de historial, ciclos y confirmaciones — cambio
   pequeño frente a uno grande y arriesgado.

**Cambio de modalidad.** Nunca transforma un ciclo empezado: cierra el actual
y abre uno nuevo, en una única transacción y tras una pantalla que dice con
números concretos qué va a pasar. Las sesiones anteriores no se mueven, no se
renumeran y su economía no se recalcula.

**Renovación mensual.** `asegurar_ciclo_mensual` es idempotente y corre
dentro de la misma transacción que la firma. Se dispara al arrancar la web y
al abrir la lista de clientes — **nunca desde Economía**: consultar una
pantalla no debe escribir en la base de datos. Un recuerdo en memoria
(`_abrir_mes_si_toca`) hace que se compruebe como mucho una vez por mes y
proceso; sin él, la lista de clientes pasaba de 3 consultas y 5,8 ms a 4 y
16,5 ms en cada carga.

**Economía mensual.** Las horas pasan a contar TODAS las sesiones firmadas,
no solo las que llevan importe (antes filtraba por `tarifa IS NOT NULL`, que
dejaría fuera las de una mensualidad). Se comprobó que no altera nada ya
cerrado: las 47 sesiones reales existentes llevan todas su tarifa. La
facturación suma sesiones + cuotas + CrossFit + ajustes, y hay un desglose
por modalidad calculado al vuelo, sin guardar nada nuevo que pueda
desincronizarse.

**Migración.** `migrar_modalidades.py` deja a todos los clientes actuales
como **bono**, que es lo que son. No hay ningún `UPDATE` de modalidad: la
columna nace con ese valor por defecto. Solo completa el precio total donde
falta, calculándolo como tarifa × sesiones. Verificada sobre copia de los
datos reales: julio 1.552,50 € / 37 h y junio 355,00 € / 10 h **idénticos**
antes y después, comparando también sesión a sesión y ciclo a ciclo.
Idempotente, `integrity_check` correcto y 0 claves rotas.

**Pruebas:** 198 en verde, 75 nuevas (`tests/test_modalidades.py` para las
reglas puras, `tests/test_tres_modalidades.py` de punta a punta).

**Decisiones prudentes pendientes de confirmar por Fernando:**

- Un cliente **pausado o cancelado no genera cuota mensual**. Cobrar
  automáticamente a quien ha dejado de entrenar sería inventar ingresos.
- Al cambiar de mes, la mensualidad nueva **nace pendiente de pago**, igual
  que un bono renovado.

### La ficha del cliente y los bonos concretos (2026-08-02)

Fernando pidió reorganizar la pantalla del cliente: tenía la información
repartida y repetida, y faltaba lo más importante — poder ver **qué bonos
concretos** ha tenido y qué sesiones fueron de cada uno.

**El problema de fondo.** El historial sabía "esta sesión fue de un Bono 4
a 45 €", pero no *de cuál* Bono 4. Si un cliente contrata el mismo bono
tres veces seguidas, agrupar por nombre de programa lo mezclaba todo en un
solo bloque de 12 sesiones. Cada contratación necesita su propia ficha.

**Tabla nueva `programas_cliente`** (`basedatos.py`): una fila por bono
contratado, con clave primaria `(cliente, ciclo_bono)`. Guarda el tipo de
programa, la **tarifa histórica** (la del momento de contratarlo, no la
actual), las sesiones que incluía, la fecha de inicio, la de fin cuando se
completa, y si se pagó. El corte entre bonos lo marca `ciclo_bono`, que ya
existía desde el sprint de integridad del 2026-07-28.

**Qué pasa en cada momento:**

- Al **dar de alta** un cliente se registra ya su bono en curso, sin fechas
  (todavía no ha entrenado). Antes la ficha salía vacía hasta la primera
  firma.
- Al **firmar** una sesión se anota también la **hora** (columna nueva
  `hora` en `historial_sesiones`, opcional: las sesiones antiguas se quedan
  sin hora, no se inventa ninguna).
- Al **renovar**, el bono que se agota se cierra con su fecha de fin y su
  estado de pago, y se abre el siguiente. Los dos quedan separados aunque
  sean el mismo programa.
- Al **renombrar** un cliente, sus bonos le siguen; al **borrarlo**, se van
  con él (no quedan huérfanos).

**Migración `migrar_programas_cliente.py`.** Reconstruye los bonos pasados
desde el historial existente. No inventa nada: las fechas salen de la
primera y la última sesión de cada bono, la tarifa de las propias sesiones,
y el estado de pago de los bonos antiguos queda **desconocido** (nunca se
guardó, y no se supone). Es idempotente. Verificada sobre una copia de los
datos reales: facturación, horas, precio medio, bonos, sesiones y deudas
**idénticos** antes y después, en los 8 clientes y los 2 meses con datos;
`integrity_check` correcto y 0 claves rotas, también tras 3 ejecuciones.

El servidor se migra **solo**: `rellenar_si_falta()` corre al arrancar la
web (igual que `asegurar_tokens`) y reconstruye los bonos la primera vez,
solo si no hay ninguno. No hay que entrar al servidor a ejecutar nada, y no
se sube la base de datos local por encima de la suya — la del servidor
tiene lo que Fernando mete desde el móvil.

**La pantalla.** El nombre y el estado van en la misma línea (el estado es
un enlace a editarlo, así que no hace falta subtítulo). Debajo, el bono en
curso con su progreso y un botón que cambia el estado de pago en el sitio,
con confirmación previa — solo toca el pago, nunca sesiones ni economía.
Luego la acción principal (firmar), dos botones iguales que separan
**editar datos** (quién es y en qué estado está) de **editar programa** (el
bono), y un botón para copiar el enlace del cliente. El historial va
plegado y agrupado por bono: cada bono se despliega para ver sus sesiones
con fecha y hora. «Editar datos» tiene una zona peligrosa que solo ofrece
borrar si el cliente no tiene ninguna sesión — si ya ha entrenado, lo
correcto es cancelarlo y conservar su historial.

**Rendimiento.** La ficha pasó a hacer **4 consultas en vez de 5** (10,4 ms
frente a 18,4): el historial ya viene dentro de los bonos, y el QR solo se
consulta justo después de firmar, que es la única vez que puede aparecer.
`comprobar_rendimiento.py` se actualizó para medir la pantalla real — antes
seguía simulando la versión antigua, así que el número no decía la verdad.

**Regresión cero.** 122 pruebas en verde, 16 de ellas nuevas
(`tests/test_perfil_programas.py`), incluidas las que comprueban que dos
bonos iguales seguidos no se mezclan, que leer la ficha no escribe nada, y
que cambiar el pago no mueve ni un euro.

### Estados del cliente: activo, pausado y cancelado (2026-08-01)

Hasta ahora un cliente que dejaba de entrenar solo se podía borrar. Fernando
pidió poder **archivarlo sin perder nada**, y de paso simplificar la pantalla
de clientes para convertirla en una herramienta de gestión.

**Columna nueva `estado`** en `clientes`, con tres valores y ninguno más:
`activo`, `pausado`, `cancelado` (validados en
`clientes.repositorio.validar_estado`). Migración aditiva con `ALTER TABLE` y
valor por defecto `activo`, comprobando antes con `PRAGMA table_info` — todos
los clientes que ya existían quedan activos, que es lo que eran. Segura de
repetir; no toca historial, semanas, desglose, programas, avisos ni clases de
grupo.

**`estado` es independiente de `pendiente_pago`**, a propósito: se puede
estar pausado debiendo dinero, o cancelado y al día. La deuda no desaparece
por dejar de entrenar, así que no se mezclan en un solo campo ni «pendiente»
se convierte en un cuarto estado.

**Qué NO cambia al pausar o cancelar**: ficha, programa, tarifa, sesiones
completadas, historial, economía histórica, deuda y token/enlace personal.
Volver a `activo` desde «Editar cliente» reactiva al cliente tal y como
estaba — no se crea otra ficha ni se reinicia el bono. No hay flujo aparte de
reactivación: el selector de estado basta.

**Bloqueo de firma en dos niveles**: la interfaz no muestra el botón para
pausados y cancelados, y **la ruta `POST /cliente/<nombre>/firmar` comprueba
el estado igualmente** (responde 409 con un mensaje claro). Esconder un botón
no impide llamar a la ruta, y esta operación descuenta bono, escribe
historial y mueve dinero. Un intento bloqueado no altera nada.

**Pantalla de clientes**: título único «Lista de clientes» (fuera el
subtítulo), cuatro contadores que son también los filtros (Activos,
Pendientes de pago, Pausados, Cancelados) en cuadrícula 2 × 2. Los contadores
muestran siempre el total general y **no cambian al filtrar**: dicen cuántos
hay, no cuántos se ven. «Pendientes de pago» incluye a cualquiera que deba
dinero, esté activo, pausado o cancelado. El filtrado ocurre en el propio
navegador con atributos `data-` (sin volver a consultar SQLite en cada
pulsación, sin frameworks). Los filtros son `<button>` reales con
`aria-pressed`, y el seleccionado se distingue por color, borde y una marca
lateral — no solo por color. Las tarjetas dejan de mostrar programa y tarifa
(siguen en el perfil y en la base de datos).

**El «+» que faltaba en el móvil**: al aplicar el rediseño se sustituyó el
«+» escrito como texto por un icono cargado desde un SVG externo
(`<use href="/static/iconos.svg#i-plus">`). El archivo se servía bien, pero
**varios navegadores móviles no pintan referencias a un SVG externo** — en el
iPhone de Fernando el botón salía como «Nuevo» a secas y los iconos de la
barra inferior aparecían como manchas negras (los atributos de trazo del
archivo tampoco llegaban). Arreglado incrustando los símbolos en la propia
página (`webapp/templates/_iconos.html`) y definiendo el trazo en el CSS
(`.icono`), que funciona en todos los casos. Se eliminó `static/iconos.svg`.

**Espacio inferior**: la barra de pestañas tapaba parcialmente la última
tarjeta. El hueco reservado incluye ahora `env(safe-area-inset-bottom)`, y
las pantallas sin barra (`.sin-barra`) no reservan ese espacio.

Pruebas: `tests/test_estados_cliente.py` (30), cubriendo migración desde una
base sin la columna y ejecutada dos veces, cambios de estado en ambos
sentidos, independencia respecto al pago, conservación de todo al cancelar,
reactivación sin ficha nueva, contadores, etiquetas, filtros accesibles y
bloqueo de firma por interfaz y por ruta.

### Rediseño «Liquid Glass» y rendimiento de la interfaz (2026-07-31 / 08-01)

Fernando rediseñó la app entera por su cuenta con una herramienta de
diseño de Claude y entregó el resultado como proyecto HTML. **La estética
la lleva él**; el papel de Claude aquí es portarla fielmente y sostener el
rendimiento, no proponer alternativas visuales.

**Antes de pintar, se unificaron las ramas** (`integracion/base-unificada`):
producción corría el trabajo del QR mientras la segunda auditoría vivía en
otra rama sin desplegar. Pintar sobre una de las dos habría obligado a
fusionar después código pintado con código sin pintar. La fusión dejó dos
conflictos (ambos por añadir cosas en el mismo sitio: `firmas_publicas` vs
`ajustes_mensuales`, y la huella del CSS vs las cookies endurecidas) y
destapó dos cosas sueltas: dos formularios creados después de la pasada de
CSRF que se habían quedado sin token, y nombres reales de clientes que la
rama del QR reintroducía en la documentación.

**El sistema visual**: fondo `#F5F7F4` con una «aurora» de luces suaves
fija detrás de todo, superficies traslúcidas, un solo acento (`#1FA99A`)
reservado a lo interactivo y el color de estado aparte, radios de 16px,
columna de 430px y barra de pestañas inferior. Tipografía **Geist**
(variable, un solo archivo cubre todos los grosores) e **iconos Lucide**
(hoja SVG propia de 14 símbolos) **servidos desde el propio servidor**: la
maqueta los traía de Google y de un CDN, y este proyecto ya decidió en
julio de 2026 no depender de terceros.

**Primer intento fallido, y por qué**: se extrajeron los colores y medidas
del archivo y se aplicaron sobre la estructura HTML existente. Fernando:
*"te has inventado muchas cosas"*. Al medir contra su archivo aparecieron
desviaciones objetivas — entre ellas usar como fondo el gris del lienzo del
editor (`#e7e5e0`) en vez del de la app, 480px de ancho en vez de 430, y
una lista de clientes en dos columnas que su diseño nunca tuvo (no usa
puntos de ruptura por ancho). Ver la lección del 2026-08-01 en
`.claude/skills/lessons-learned/log.md`.

**Rendimiento — el efecto cristal es caro**: aplicar `backdrop-filter`
literalmente dejó **13 elementos desenfocando el fondo a la vez** en la
portada, y el navegador recalcula eso en cada fotograma del scroll. Medido
primero para no optimizar el sitio equivocado: el servidor respondía en
~0,5s y las consultas en 1-2 ms, así que no era el servidor. Se retiró el
desenfoque de todo lo que hace scroll (blanco algo más opaco, visualmente
casi idéntico sobre un fondo suave) y quedó solo en las ventanas
superpuestas. Seguía pesado: faltaba lo peor, en la barra inferior, que es
**fija y está siempre en pantalla** — llevaba a la vez `filter: blur(28px)`
y `backdrop-filter: blur(26px) saturate(210%) brightness(1.04)`. El halo
pasa a dibujarse ya difuminado con degradados radiales (mismo aspecto, cero
cálculo). Además: logo de 70 KB que se mostraba a 30px → 8 KB, favicon 35
KB → 13 KB. **La primera visita bajó de 175 KB a 92 KB y durante el scroll
no queda ningún desenfoque.**

**Señal de carga** (`webapp/static/carga.js`): cada navegación cuesta
~0,5-0,7s por el plan de alojamiento, no por el código. Una línea de 3px
arriba por la que pasa una luz de lado a lado mientras se espera. No finge
un porcentaje a propósito — no se sabe cuánto tardará el servidor, y una
barra que se llena y luego deja esperando se nota falsa. Tres iteraciones
hasta acertar: la primera no se veía (se desvanecía 0,2s de una espera de
0,6s), la segunda era ruidosa (girador sobre lo pulsado + bloqueo de
pantalla) y encima **solo funcionaba en una navegación**: el fundido entre
pantallas (`@view-transition`) congela la página anterior nada más pulsar,
así que la animación se helaba justo al empezar. Ese fundido se retiró.

Auditados después los 34 elementos navegables de las 14 pantallas, con tres
causas más de que no saltara siempre: el script iba con `defer` al final del
body (no escuchaba durante los primeros instantes de cada pantalla, ahora va
en la cabecera), dos formularios de Economía preguntan «¿seguro?» y al
cancelar dejaban la barra encendida para siempre, y no había salvavidas si
se caía la red (ahora se apaga sola a los 15s).

### Segunda auditoría de integridad (2026-07-30)

Rama `fix/integridad-fiabilidad-2`, salida de `fix/integridad-fiabilidad`.
**Sin merge ni despliegue todavía**, a la espera de revisión de Fernando.
Cierra los huecos que una segunda auditoría externa detectó sobre el primer
sprint. Todo lo medido se hizo sobre una copia de producción; producción no
se tocó en ningún momento.

**1. Meses históricos que perdían facturación.** La vista mensual pasó a
calcularse desde `historial_sesiones` (fecha real), pero el historial
anterior al 2026-07-22 está incompleto: hay sesiones cobradas cuya fecha
nunca se registró. Medido sobre la copia real: julio salía **112,50 € y 3
horas por debajo** del cierre ya dado por bueno (3 sesiones de un cliente
sin fila en el historial, en las semanas del 1 y del 20 de julio), y
aparecía un junio de 355 €/10 h que la vista antigua nunca mostró (sus
sesiones sí tienen fecha, pero ninguna fila de `semanas` las cubría).
Solución: tabla `ajustes_mensuales` (anio, mes, origen, importe, horas,
motivo) y `migrar_ajustes_legacy.py`, que **calcula la diferencia desde los
propios datos** (economía guardada menos sesiones con fila) sin inventar
ninguna fecha, solo para semanas que caen enteras dentro de un mes; las que
cruzan dos meses dejan un aviso en vez de repartirse a ojo. El ajuste se
suma al mes pero se muestra como **línea propia con su motivo** en Economía
— la diferencia queda visible y documentada, nunca oculta. Verificado: tras
aplicarlo, julio vuelve exactamente a 2.727,50 €/67 h, y repetirlo no
acumula.

**2. Migración real de `ciclo_bono`.** La migración del 2026-07-28 marcó
todas las filas existentes como ciclo 1, sin distinguir bonos ya renovados
antes. `migrar_ciclo_bono.py` recorre el historial de cada cliente por
(fecha, id), detecta los reinicios de numeración, asigna los ciclos, ajusta
`clientes.ciclo_bono` y **valida** el resultado contra `sesiones_completadas`
y `pendiente_pago`. Lo ambiguo (un bono que arranca en un número distinto de
1, un contador que no cuadra) genera un aviso en vez de adivinarse. Es
idempotente. Sobre la copia real no cambia ningún ciclo (ningún cliente ha
renovado dentro del historial registrado) pero **detectó una incoherencia
real**: un cliente cuya última sesión registrada es la 14 mientras su
contador marca 0.

**3. Firmas simultáneas.** `registrar_sesion_pt` leía el programa y la
tarifa FUERA de la transacción, así que dos firmas del mismo cliente a la
vez podían leer el mismo estado y calcular el mismo número de sesión. Ahora
todo (lectura del estado, idempotencia, cálculo, bono, historial, economía y
avisos) ocurre dentro de una única transacción `BEGIN IMMEDIATE`
(`basedatos.transaccion(inmediata=True)`), que coge el bloqueo de escritura
antes de leer. En modo WAL esto no penaliza las lecturas normales; solo
serializa a los escritores. Hay un test con dos hilos que firman a la vez.

**4. Correcciones alrededor de una renovación.** Modificar o borrar una
sesión de un bono ya cerrado, cuando existen sesiones de bonos posteriores,
queda **bloqueado con un mensaje claro** en vez de recalcular en silencio
toda la historia posterior (decisión para la v1: seguridad y simplicidad; un
recálculo completo se diseñaría aparte y se presentaría antes de
construirlo). El bono en curso se sigue pudiendo corregir con normalidad.

**5. Un solo camino capaz de descontar bonos.** Se confirmó que el trigger
antiguo de actualización diaria (`trig_01JZ6et1nsACiTiu9Ho2rnt8`) **seguía
habilitado y se había disparado la noche del 2026-07-29** — desactivado.
Además: `/admin/procesar-dia` responde 410 y ya no procesa nada,
`/admin/debug` eliminada, y `cierre_semanal aplicar` bloqueado (escribía
bonos y **sustituía** el desglose de la semana, así que habría borrado la
economía de las sesiones firmadas a mano). `/admin/verificar-semana` sigue
como comprobación de solo lectura y `/admin/backup` sin cambios.

**6. CrossFit Kids entre meses.** El reparto usaba el mes del LUNES de cada
semana y el conteo guardado en `semanas`. Ahora cada clase se valora al
precio de SU mes (calculado desde `clases_grupo`) y se suma a la semana que
de verdad la contiene, así que una semana con una clase el 31 de julio y
otra el 1 de agosto suma la parte de cada mes por separado. Las horas de
Kids se suman a la semana en cuanto hay facturación (antes no se sumaban
nunca, lo que inflaba el precio medio por hora), y la semana se marca
`provisional` mientras falte el importe.

**7. Migración de esquemas antiguos.** Se reconstruyen por test las formas
anteriores de la base de datos (historial con `UNIQUE(cliente, fecha)`, sin
`tarifa`, sin `ciclo_bono`; `clientes` sin `ciclo_bono`; `semanas` con
`facturacion_kids` sin `facturacion_kids_mensual`) y se ejecuta
`crear_esquema` **dos veces**, comprobando filas, importes, columnas,
`integrity_check` y `foreign_key_check`. Esto destapó un bug real: la
reconstrucción que quita el `UNIQUE` recreaba la tabla **sin `ciclo_bono`**,
perdiendo la columna y sus valores en silencio (el `ALTER TABLE` que la
añade corre antes, así que un arreglo deshacía el otro). Corregido copiando
el esquema completo y solo las columnas que la tabla vieja tenía.

**8. Repositorio público.** Ver la sección de protección del trabajo y las
reglas nuevas en `.claude/CLAUDE.md`. Se sustituyeron todos los nombres de
clientes reales por `Cliente A` / `Pareja C`… en documentación y
comentarios. No había credenciales, tokens ni URLs con token en archivos
versionados.

**9. Seguridad mínima.** Token CSRF en los 14 formularios de escritura
(comprobado en `before_request`, con las rutas de máquina como única
excepción porque no usan cookie); cookies `HttpOnly`, `SameSite=Lax` y
`Secure` (desactivable con `ANTIFRAGIL_COOKIES_INSEGURAS=1` para probar en
local); `secrets.compare_digest` para el token administrativo
(`webapp.auth.token_admin_valido`); y la pantalla de alta de contraseña pide
ahora `ANTIFRAGIL_SETUP_TOKEN` — antes, una instalación nueva dejaba que el
primer visitante se quedara con el control.

**10. Validación.** Suite ampliada a 56 pruebas (17 previas + 39 nuevas en
`tests/test_auditoria2.py`), todas en verde, y GitHub Actions
(`.github/workflows/tests.yml`) las ejecuta en cada push y PR.

### Sprint de integridad y fiabilidad (2026-07-28)

Petición explícita de Fernando (relayed desde un análisis de ChatGPT como
segunda opinión sobre el proyecto): antes de seguir añadiendo funciones,
garantizar que bonos, historial y economía nunca puedan descuadrarse
silenciosamente. Rama `fix/integridad-fiabilidad`, sin merge todavía (a la
espera de aprobación de Fernando). Diez problemas planteados, los diez
confirmados como reales contra el código, y corregidos:

**1. Zona horaria centralizada** (`zona_horaria.py`, `hoy_negocio()`/
`ahora_negocio()`, `Europe/Madrid`): antes se usaba `date.today()`/
`datetime.now()` directamente en `registrar_asistencia.py`, `webapp/app.py`,
`verificar_semana.py`, `cierre_semanal/cli.py` — si el servidor corre en
UTC, entre medianoche y ~1-2 de la madrugada en Madrid el servidor todavía
estaría "ayer", pudiendo firmar sesiones con la fecha equivocada. Requiere
el paquete `tzdata` (Windows no trae datos de zonas horarias con Python de
serie) — añadido a `requirements.txt`.

**2. Meses que cruzan semana**: `listar_meses`/`obtener_mes` agrupaban
`semanas` por el `anio`/`mes` del LUNES de cada semana — una sesión del 1
de agosto en la semana del 27 de julio-2 de agosto se contaba entera en
julio. Corregido: ahora se calculan directamente desde `historial_sesiones`
y `clases_grupo`, agrupando por la fecha real de cada fila
(`economia/registro.py`, `_calcular_mes_desde_historial`). La vista
SEMANAL (`obtener_semana`) no cambia — sigue mostrando ambas sesiones
juntas en la misma semana natural, que es lo esperado.

**3. Tarifa histórica**: `editar_sesion_pt`/`eliminar_sesion_pt` recalculaban
la economía con `cargar_tarifas()` (la tarifa ACTUAL del cliente) en vez de
la tarifa guardada en el momento de la sesión. `editar_historial`/
`eliminar_historial` ahora devuelven también `tarifa`, y
`registrar_asistencia.py` la usa siempre en vez de volver a consultarla.

**4. CrossFit Kids inconsistente entre semana y mes**: la vista mensual no
sumaba la facturación de Kids al total (la semanal sí), y ninguna de las
dos sumaba sus horas a "Horas". Nueva tabla `facturacion_kids_mensual`
(clave real año/mes, no ligada al lunes de una semana). El mes se marca
`provisional` mientras haya clases de Kids sin facturación introducida
todavía — la plantilla de Economía lo avisa antes del importe y las horas.

**5. Operaciones atómicas**: firmar/editar/borrar una sesión, y firmar/
deshacer una clase de grupo, hacían 3-4 guardados independientes (bono,
historial, economía, avisos). Nuevo `basedatos.transaccion()` (gestor de
contexto sobre una única conexión) — todos los repositorios implicados
(`aplicar_actualizaciones`, `registrar_historial`, `editar_historial`,
`eliminar_historial`, `marcar_pendiente_pago`, `registrar_semana`,
`obtener_desglose_semana`, `obtener_semana`, `registrar_aviso`) aceptan
ahora un parámetro `conexion` opcional para participar en la misma
transacción que quien los llama. Un test provoca un fallo a mitad de
`registrar_sesion_pt` y confirma que no queda nada guardado.

**6. Ciclo de bono**: columna `ciclo_bono` nueva en `clientes` y
`historial_sesiones` — cada renovación incrementa el ciclo del cliente, y
cada sesión guarda a qué ciclo pertenece. Reproducido el bug exacto que
describió Fernando (bono de 12, sesión 12 renueva, se firma la sesión 1
del bono nuevo, se borra esa sesión 1 → el contador debía volver a "0",
no a "12" del bono anterior) y confirmado con un test que fallaba antes
del arreglo. Corrección real encontrada AL PROBAR el propio arreglo:
al borrar la sesión que completó un bono, hay que devolver también el
`ciclo_bono` del cliente al ciclo anterior antes de recalcular las
sesiones completadas — si no, el recálculo mira el ciclo nuevo (que se
queda vacío) y pone 0 en vez del número correcto del ciclo anterior.

**7. Renombrado y validaciones**: renombrar un cliente con historial
violaba la clave foránea (`historial_sesiones.cliente` apuntaba un
instante al nombre viejo mientras `clientes.nombre` ya tenía el nuevo).
Arreglado con `PRAGMA defer_foreign_keys = ON` — pero **con una condición
no obvia**: solo funciona si se abre una transacción explícita (`BEGIN`)
antes; si no, Python trata cada sentencia (incluidas las `SELECT` previas
de validación) como su propia transacción y el aplazamiento se pierde
antes de llegar a los `UPDATE`. Encontrado probando el propio arreglo, no
por lectura de documentación. Añadidas validaciones de servidor: sesiones
completadas no negativas ni por encima del programa, número de sesión
entre 1 y el total, fechas válidas, tarifas y sesiones de programa
positivas.

**8. Doble envío**: además del botón desactivado en el navegador (que
evita el doble toque físico, pero no un reintento de red ni dos pestañas),
`clave_idempotencia` — un valor de un solo uso generado en cada carga de
la página del perfil — impide guardar la misma petición de firma dos
veces (tabla `firmas_idempotencia`). Recargar la página genera una clave
nueva, así que una segunda sesión real sí se puede firmar sin problema.

**9. Copia de seguridad consistente**: `/admin/backup` entregaba el
archivo SQLite vivo directamente — en modo WAL, leerlo mientras otra
petición escribe podría copiar un estado a medio guardar. Ahora usa
`sqlite3.Connection.backup()` para generar una foto consistente en un
archivo temporal, la envía, y la borra después.

**10. Suite de regresión** (`tests/test_integridad.py`, `unittest`, sin
dependencias nuevas): 17 pruebas, todas contra archivos SQLite temporales
propios, nunca contra `datos/antifragil.db`. Cubre renovación normal,
varias sesiones el mismo día, borrado/edición, tarifa histórica, cambio de
semana/mes/año, CrossFit Kids, fallo a mitad de transacción, renombrado,
valores inválidos, y comparación historial↔economía. Tres de los diez
arreglos anteriores (6 y 7, y el caso general de #5) se corrigieron
gracias a que la propia suite los hizo fallar primero — no se dieron por
buenos solo por revisión de código.

**Hallazgo de seguridad aparte (ver sección de abajo)**: el repositorio de
GitHub creado el mismo día para darle acceso a ChatGPT llevaba siendo
público desde su creación pese a haberse pedido `--private` explícitamente
— corregido, sin secretos ni datos de clientes filtrados según revisión
completa del historial de Git.

**Arquitectura económica — análisis presentado, sin migración grande
todavía** (pendiente de decisión de Fernando):

- *Opción mínima (ya implementada en este sprint)*: `semanas`/`desglose`
  siguen existiendo como agregado editable, pero cada operación que los
  toca es ahora atómica y se verifica sola contra el historial real tras
  cada cambio. Resuelve la causa raíz de los descuadres (operaciones no
  atómicas) sin tocar la vista semanal ni migrar datos históricos.
- *Opción simplificada*: eliminar `semanas`/`desglose` del todo y calcular
  también la vista SEMANAL directamente desde `historial_sesiones`/
  `clases_grupo`, igual que ya se hace ahora con la mensual. Elimina el
  estado duplicado de raíz. Riesgo real: las semanas anteriores al
  2026-07-22 (antes de firmar a mano) tienen huecos conocidos en el
  historial (p. ej. el de Cliente A) — recalcularlas desde ahí daría cifras
  MÁS BAJAS que las ya cerradas y comunicadas a Fernando, una regresión
  sobre datos históricos ya usados. Esfuerzo medio-alto.
- **Recomendación**: quedarse con la opción mínima por ahora — el problema
  real ya está resuelto y el riesgo de tocar cifras históricas cerradas no
  se justifica todavía. Revisar la opción simplificada más adelante si
  Fernando lo pide explícitamente.

### Migración de Excel a SQLite (2026-07-18)

**El sistema real ya no usa Excel.** `datos/clientes.xlsx` y
`datos/facturacion.xlsx` (y todo lo que se cuenta más abajo sobre ellos) es
**historia de cómo se llegó hasta aquí**, no el estado actual. La base de
datos real es `datos/antifragil.db` (SQLite), con tablas `programas`,
`clientes`, `semanas` y `desglose` — ver `basedatos.py`.

Por qué: Fernando quería una web app (`webapp/`, proyecto de aprendizaje
Flask) sin tener que abrir Excel para nada, y con vistas a alojarla en
internet más adelante — la mayoría de alojamientos no garantizan que un
archivo Excel sobreviva a un reinicio, y SQLite es el estándar real para
esto. Se decidió que la migración fuera completa (no solo para la web:
también `clientes/repositorio.py`, `economia/registro.py` y
`cierre_semanal/`), retirando el Excel del todo.

Se secuenció con cuidado: el domingo 19 de julio de 2026 era el primer
cierre semanal real, así que la migración se hizo el sábado 18, con tiempo
de sobra para probarla a fondo antes — no a última hora ni durante el
cierre en sí.

Lo que cambió técnicamente:
- `clientes/repositorio.py` y `economia/registro.py` mantienen exactamente
  las mismas funciones públicas (`leer_clientes`, `crear_cliente`,
  `actualizar_cliente`, `registrar_semana`, `obtener_mes`...), así que
  `cierre_semanal/`, `economia/cli.py` y `webapp/app.py` no necesitaron
  cambiar ni una línea de sus llamadas a estas funciones.
- `migrar_excel_a_sqlite.py`: script de migración de una sola vez (lee el
  Excel real con `openpyxl` y rellena `datos/antifragil.db`). Es seguro
  volver a ejecutarlo.
- Desaparecen de raíz problemas que antes había que gestionar con Excel:
  fórmulas que perdían su valor calculado al guardar, desplegables que
  Excel reescribía en un formato que `openpyxl` no entendía, y bloqueos
  por tener el archivo abierto (ver lecciones del 2026-07-15/16 en el
  log). Con SQLite no hay ninguno de estos tres problemas.
- Terminología de columnas simplificada de paso: las claves económicas ya
  no llevan tildes ni espacios (`facturacion_total` en vez de
  `"Facturación Total"`), y los totales del mes se calculan al vuelo con
  SQL (`SUM(...) GROUP BY`) en vez de guardarse aparte.
- `clientes/generar_plantilla.py` (generador del Excel con formato) se
  eliminó — ya no tiene sentido sin Excel.

Probado de punta a punta antes de dar la migración por buena: migración de
los 7 programas y 8 clientes reales, `cierre_semanal previsualizar` con
datos reales de Calendar (resultado idéntico al de la versión en Excel:
630€/15h/42€), `aplicar` completo en una copia de la base de datos
(sesiones actualizadas correctamente, semana y mes registrados), y la web
app (Clientes, Economía, crear/editar) sirviendo los datos reales
correctamente.
- Dashboard móvil (2026-07-16): página privada publicada como Artifact de
  Claude (no requiere servidor propio) mostrando el resumen semanal/mensual
  y el estado de cada cliente, para verlo cómodo desde el móvil:
  https://claude.ai/code/artifact/eab83d88-cb41-41a3-8040-d5915d5a7079 —
  **no se actualiza sola**; hay que republicar el mismo archivo después de
  cada cierre semanal para que refleje los datos nuevos. Fuente:
  `dashboard.html` (se regenera con los datos de `datos/clientes.xlsx` y
  `datos/facturacion.xlsx`, no vive en el repositorio de código porque son
  datos, no lógica). Es **de solo lectura**: Fernando pidió poder editar
  también desde la web sin tocar el Excel, y se decidió no hacerlo — un
  Artifact no puede escribir en un archivo del ordenador de Fernando; para
  eso haría falta un servidor y una base de datos reales, que es justo la
  complejidad que `SYSTEM_VISION.md` pide evitar en esta fase. Fernando
  sigue pidiendo los cambios por chat y Claude actualiza el Excel — el
  Excel pasa a ser "el cuaderno de Claude", no algo que Fernando necesite
  abrir. La idea de dar acceso a los propios clientes a su perfil queda
  aparcada como módulo futuro (requeriría cuentas de usuario reales).

### Sincronización automática con el servidor (2026-07-19)

Primer cierre semanal real hecho sobre SQLite (semana 13-19 julio 2026,
630€/15h/42€h — coincide con los cálculos previos validados en Excel).

Tras ese cierre, Fernando pidió que la web alojada en PythonAnywhere se
mantuviera al día sin ningún paso manual — "yo solo quiero tocar Calendar".
El problema real: `datos/antifragil.db` vive en su ordenador (único sitio
donde Claude puede escribir, ya que solo Claude tiene acceso al conector de
Calendar, y solo dentro de una conversación), mientras que el servidor
tiene su propia copia del archivo — sin nada que las mantenga iguales,
habría que volver a subir el archivo a mano cada semana.

Solución: `sincronizar_servidor.py`, que usa la **API propia de
PythonAnywhere** (no Google, no OAuth nuevo — evita repetir el error de
sobreingeniería del 2026-07-14) para subir `datos/antifragil.db` y recargar
la web automáticamente. `cierre_semanal/cli.py` la llama al final del modo
`aplicar`, así que confirmar el cierre semanal ya deja la web pública al
día en el mismo paso, sin que Fernando tenga que entrar a PythonAnywhere.

### Actualización diaria automática y avisos (2026-07-21)

Fernando pidió ir un paso más allá de sincronizar tras el cierre semanal:
que clientes y economía se actualicen solos **cada día**, sin que él tenga
que confirmar nada. Decisión explícita: sin pantalla de confirmación diaria
(a diferencia del cierre semanal) — en su lugar, un sistema de "avisos"
para lo que no se pueda procesar solo (evento sin clasificar, cliente sin
programa...), revisable a posteriori en `/avisos`.

Límite real descubierto: una rutina programada de Claude Code corre **en
la nube**, no en el ordenador de Fernando — no puede tocar
`datos/antifragil.db` local. Se decidió (con Fernando, explícitamente) que
el **servidor pase a ser la copia viva** a partir de ahora; el ordenador de
Fernando queda como copia secundaria.

Piezas nuevas:
- `procesar_dia.py`: como `cierre_semanal/cli.py` pero para un solo día,
  sumando su desglose económico al de la semana en curso (`obtener_desglose_semana`
  en `economia/registro.py`) en vez de sustituirlo.
- `webapp/app.py`, ruta `/admin/procesar-dia`: recibe los eventos del día
  (en crudo, tal cual Calendar) por POST, protegida con un token de
  máquina (`webapp/auth.py: obtener_admin_token`), no con la contraseña de
  Fernando — la llama una rutina automática, no un navegador.
- `avisos.py` + tabla `avisos`: registra lo que la actualización diaria no
  pudo procesar sola. Con distinción "nuevo" (`leido=0`) / "ya visto" — al
  entrar en `/avisos` se marcan todos como leídos, y un contador en el menú
  avisa de cuántos hay nuevos sin tener que entrar.
- Rutina en la nube ("Antifragil - actualizacion diaria", trigger
  `trig_01JZ6et1nsACiTiu9Ho2rnt8`, cron `45 21 * * *` = 23:45 hora de
  Madrid): lee Calendar del día con su propio conector y hace POST a
  `/admin/procesar-dia`.

**Puesta en marcha con problemas (2026-07-21):** el disparo manual
("ejecutar ahora" y `run_once_at` a pocos minutos vista) no funcionó en
9 intentos distintos, incluida la prueba más simple posible (un solo
`curl`, o crear un único evento de Calendar sin salir a internet). Se
encontró la causa probable revisando otra rutina ya existente de Fernando
(el "Briefing Ejecutivo", activa desde junio): esa rutina **sí** se dispara
todos los días por cron sin fallar — la prueba está en sus borradores de
Gmail, uno por día. Conclusión: el disparo programado real (cron) funciona;
el botón de disparo manual/inmediato parece tener un fallo aparte, no
relacionado con la configuración de esta rutina. Pendiente de confirmar
con el primer disparo real de esta noche.

`webapp/app.py` también gana `/admin/debug`, una ruta de diagnóstico
temporal (mismo token) para que la rutina deje constancia de errores sin
que Fernando tenga que mirar nada — se puede borrar una vez esto funcione
de forma estable.

### Registro de asistencia en el momento (2026-07-22) — sustituye a Calendar para el día a día

Tras no poder verificar que la rutina automática de Calendar funcionara de
verdad (9 intentos de prueba sin ningún resultado observable, ver sección
anterior), Fernando propuso un cambio de fondo: en vez de perseguir una
automatización invisible que no se podía comprobar, **confirmar cada
sesión con un toque nada más terminarla**, desde su propio móvil. Mejor
una herramienta simple y fiable que depende de él, que una automática que
depende de un sistema en la nube fuera de nuestro control.

- **PT**: botón "✓ Firmar sesión de hoy" en cada tarjeta de cliente
  (`/cliente/<nombre>/firmar`) — descuenta del bono (con renovación
  automática si tocaba), guarda la fecha en su historial, y suma la sesión
  a la economía de la semana en curso. Todo en el momento, sin pantalla de
  confirmación previa (el propio toque ya es la confirmación) — a
  diferencia del cierre semanal manual, que sí la lleva.
- **CrossFit Lidomare / Kids**: no son de un cliente concreto, así que
  llevan sus propios botones en la pestaña Economía ("+1 CrossFit Lidomare
  hoy" / "+1 CrossFit Kids hoy", `/clase/<tipo>/firmar`) — solo suman a la
  economía de la semana, sin tocar ningún cliente.

Piezas nuevas:
- `programas/procesar.py`: se extrajo `procesar_una_sesion()` de dentro
  del bucle de `procesar_semana()` — la misma lógica de renovación de
  bonos, ahora reutilizable tanto para procesar una semana entera (fecha a
  fecha) como para confirmar una sola sesión al momento, sin duplicar
  código.
- `registrar_asistencia.py`: `registrar_sesion_pt()` y
  `registrar_clase_grupo()` — usan `procesar_una_sesion()` y el mismo
  reparto económico semanal aditivo (`obtener_desglose_semana`) que ya se
  había construido para la actualización diaria por Calendar.

**Calendar queda aparcado para este propósito** (sigue sirviendo para que
Fernando planifique su semana, simplemente ya no hace falta leerlo para
contar sesiones). La rutina en la nube (`trig_01JZ6et1nsACiTiu9Ho2rnt8`) no
se ha borrado por si se retoma más adelante, pero no es la vía activa.

### Incidente: caída del servidor real al desplegar solo parte de un cambio (2026-07-29)

Al probar la firma pública (ver más abajo), se detectó que el sprint de
integridad y fiabilidad del día anterior (2026-07-28, rama
`fix/integridad-fiabilidad`) **nunca se había desplegado al servidor
real** — solo existía como commits en el repositorio, sin llegar a
`tatu17.pythonanywhere.com`. El despliegue a este servidor no sigue a
Git automáticamente: se hace subiendo archivos sueltos por la API de
PythonAnywhere (`sincronizar_servidor.py`), así que un cambio puede
quedar commiteado sin estar realmente en producción.

Al subir solo los 4 archivos de la firma pública (que ya asumían tener
como base todo el sprint del día anterior — `zona_horaria.py`,
`transaccion()`, `ciclo_bono`...), el servidor real se cayó
(`ModuleNotFoundError: No module named 'zona_horaria'`, error 500 en
toda la web, no solo en la función nueva). Diagnosticado leyendo el log
de errores real del servidor vía la API de PythonAnywhere
(`GET /api/v0/user/<usuario>/files/path/var/log/<dominio>.error.log`).

**Arreglo**: en vez de revertir, se desplegaron TODOS los archivos de
código que cambiaron desde la última versión que sí estaba en el
servidor (14 archivos: todo el sprint de integridad + la firma pública),
con aprobación explícita de Fernando para hacerlo directamente. El
esquema de la base de datos real se migró solo (las migraciones de
`crear_esquema()` son aditivas, se disparan al arrancar la app) sin
tocar el archivo de datos del servidor directamente en ningún momento.
Verificado tras el redespliegue: la web vuelve a responder (200), el
flujo de firma pública funciona de punta a punta contra el cliente de
prueba real del servidor, y no hay errores nuevos en el log.

**Lección para la próxima vez que algo cambie en varios archivos a la
vez**: antes de subir un cambio parcial al servidor, comprobar primero
qué versión del código tiene realmente desplegada (no asumirlo por lo
que hay en `main` — puede llevar días o semanas desincronizado de
Git) y desplegar el conjunto completo de archivos que dependen entre
sí, no solo los directamente relacionados con la función nueva.

**Nota de estado**: a partir de este despliegue, el servidor real ya
tiene en producción tanto el sprint de integridad y fiabilidad como la
firma pública — aunque en Git ninguna de las dos ramas se ha fusionado
todavía a `main` (eso sigue pendiente de revisión y aprobación de
Fernando, son cosas separadas: desplegar ≠ fusionar a `main`).

### Confirmación pública de sesión desde el enlace personal del cliente (2026-07-29)

Hasta ahora `/mi/<token>` (perfil público por cliente, milestone 4, ver más
abajo) era de solo lectura. Fernando pidió que el propio cliente pudiera
intervenir desde ese mismo enlace en relación con su sesión de hoy, sin
tocar nada del flujo de Fernando, que sigue funcionando exactamente igual.

**Primer diseño, descartado el mismo día antes de darlo por bueno**: el
cliente firmaba su propia sesión (creando una entrada nueva en su
historial), reutilizando `registrar_sesion_pt()`, con un límite de una
firma al día desde el enlace público. Al preguntarle a Fernando cómo
debía comportarse si él YA había firmado la sesión de ese cliente desde su
perfil, se detectó el riesgo real: el cliente podía firmar también la
suya, y esa sesión se contaría dos veces por un solo entrenamiento — el
mismo tipo de descuadre que el sprint de integridad del día anterior
arregló para Pareja C, solo que por una vía nueva. Se descartó antes
de que ningún cliente real lo usara.

**Diseño definitivo, propuesto por Fernando**: el cliente nunca crea una
sesión. Fernando sigue firmando exactamente igual que siempre
(`registrar_sesion_pt`, sin ningún cambio). El cliente solo puede
**confirmar** que la sesión que Fernando ya registró hoy es correcta —
una anotación aparte que no toca el bono, el historial ni la economía en
ningún caso, así que es matemáticamente imposible que duplique nada.
Módulo `firma_publica.py`:

- **El botón "Confirmar mi sesión de hoy" solo aparece si Fernando ya ha
  firmado una sesión de ese cliente hoy** (`hay_sesion_hoy()`, consulta a
  `historial_sesiones`). Si Fernando aún no ha firmado nada, el cliente no
  ve ningún botón — no hay nada que confirmar todavía.
- **Confirmar solo inserta una fila en `firmas_publicas`** (cliente,
  fecha, hora) — la misma tabla del primer diseño, reutilizada con un
  significado distinto (antes "creé una sesión", ahora "confirmo la
  sesión de hoy"). No pasa por `registrar_sesion_pt` en absoluto.
- **Recibo permanente**: "Confirmada el {fecha} a las {hora}", visible
  cada vez que el cliente vuelve a entrar ese mismo día.
- **Aviso a Fernando cuando el cliente confirma** (`avisos.py`, tipo
  `confirmacion_cliente`).
- **Aviso a Fernando cuando el cliente NO confirma**: `avisar_confirmaciones_pendientes()`
  revisa desde `FECHA_INICIO_CONFIRMACIONES` (el día en que se lanzó esta
  función) hasta ayer (nunca el día de hoy, para no avisar antes de que el
  cliente haya tenido toda la jornada para confirmar) y deja un aviso
  (`confirmacion_pendiente`) por cada sesión de un cliente que Fernando
  firmó y nadie confirmó desde el enlace. No hay una tarea programada
  detrás — no hay forma fiable de avisar en tiempo real, ya se intentó con
  la actualización automática de Calendar en julio y no se pudo verificar
  que funcionara (ver sección de más abajo). En vez de eso, se llama sola
  en las dos páginas que Fernando abre de forma habitual (`/` y `/avisos`)
  — el aviso aparece la próxima vez que entra a la web, como el resto de
  avisos del sistema. Decisión explícita de Fernando: "si me avisa cada
  vez que abro la app me vale".

  **Primera versión de esta comprobación, arreglada el mismo día**: al
  principio miraba una ventana móvil de "los últimos 14 días" en vez de
  desde el lanzamiento — el primer día que Fernando la usó le aparecieron
  **28 avisos de golpe**, uno por cada sesión antigua que nunca pudo
  confirmarse porque la función todavía no existía cuando se firmó.
  Corregido acotando la revisión a partir de `FECHA_INICIO_CONFIRMACIONES`
  (fecha fija, no una ventana relativa a "hoy"). De paso se añadió
  `resolver_avisos_por_tipo()` (`avisos.py`) y un botón "Descartar todos"
  por tipo en `/avisos`, para poder limpiar de golpe un tipo de aviso que
  se dispara en cantidad — útil para este caso y para cualquier otro
  parecido en el futuro.

  **Segunda corrección, mismo día — confirmar por sesión, no por día**:
  Fernando preguntó qué pasaba si firmaba dos sesiones del mismo cliente
  el mismo día (algo que ya podía hacer desde el 2026-07-24) — con el
  diseño de entonces, `firmas_publicas` guardaba la confirmación por
  (cliente, fecha), así que la primera confirmación "gastaba" el día
  entero y la segunda sesión ya no se podía confirmar nunca. Arreglado
  añadiendo `sesion_id` a `firmas_publicas` (referencia a
  `historial_sesiones.id`, migración aditiva en `crear_esquema()`): cada
  fila confirma una sesión concreta, no un día. `hay_sesion_hoy()` pasó a
  `hay_sesion_pendiente_de_confirmar()` (mira si queda alguna sesión de
  hoy sin su confirmación) y `confirmacion_de_hoy()` (una sola) pasó a
  `confirmaciones_de_hoy()` (lista — puede haber varias). El QR/botón
  reaparece automáticamente después de cada sesión nueva que Fernando
  firme, aunque sea el mismo cliente el mismo día.
- **Solo puede confirmar la sesión del cliente dueño del token**: la ruta
  `/mi/<token>/confirmar` resuelve el nombre a partir del token con
  `obtener_cliente_por_token()`, nunca de un dato del formulario.
- **Editar y borrar siguen siendo solo de Fernando**, sin cambios.

Probado de punta a punta contra una base de datos temporal (nunca
`datos/antifragil.db`): sin sesión de Fernando no hay botón → tras firmar
Fernando aparece el botón → el cliente confirma y ve el recibo → el
historial y el bono no cambian ni una unidad al confirmar → un segundo
intento de confirmar no duplica nada y no se ve como error → Fernando
puede firmar una segunda sesión el mismo día sin límite → aviso de
confirmación creado → una sesión de ayer sin confirmar genera el aviso de
pendiente al re-ejecutar la comprobación (simulando abrir `/` o
`/avisos`) → una sesión de hoy sin confirmar NO genera aviso todavía →
Fernando puede editar y borrar la sesión aunque el cliente ya la haya
confirmado. Tests de regresión en `tests/test_firma_publica.py` (10
pruebas).

### Confirmar por QR en vez de por enlace (2026-07-29)

Fernando propuso ir un paso más allá de la confirmación por enlace: un
código QR que le enseña al cliente justo después de firmarle la sesión,
de forma que confirmar pase a ser parte del propio momento con él (que
siempre ocurre) en vez de depender de que el cliente entre luego por su
cuenta a su enlace (que podía no pasar).

**Decisión técnica clave — generar el QR en el navegador, no en el
servidor**: la forma habitual (librería Python `qrcode`) habría requerido
instalar un paquete nuevo en el servidor real de PythonAnywhere. Al
comprobarlo, la API de PythonAnywhere no permite ejecutar `pip install`
sin que antes se abra una consola manualmente en el navegador al menos
una vez (se intentó por API, tanto sobre una consola ya existente como
creando una nueva — las dos exigen ese primer arranque manual). Como el
mismo día ya se había tumbado la web una vez por desplegar código que
dependía de algo no instalado, se descartó ese camino: en vez de generar
el QR como imagen en Python, se autoaloja una librería JavaScript sin
dependencias (`davidshimjs/qrcodejs`, ~20&nbsp;KB, `webapp/static/js/qrcode.min.js`,
descargada una sola vez, nunca cargada desde un CDN) y el QR se dibuja en
el propio navegador de Fernando al cargar la página del cliente. Cero
paquetes nuevos en el servidor, cero riesgo de repetir el incidente de
esta mañana.

**Diseño**: el QR codifica la URL de confirmación de ese cliente
(`/mi/<token>/confirmar`) — el mismo destino que el botón manual del
propio cliente, sin ninguna lógica de negocio nueva. La única pieza nueva
de verdad es que esa ruta pasó a aceptar también `GET`, no solo `POST`:
al escanear el QR, el móvil del cliente simplemente abre esa URL, lo que
ya confirma en el acto — sin que tenga que pulsar ningún botón después.
Es una excepción consciente a "un GET no debe tener efectos secundarios",
asumida porque la acción es segura de repetir (como mucho ya estaba
confirmada, `confirmar_sesion_publica` ya lo controla) y el token de la
URL ya hace de autorización.

El QR aparece en el perfil de administrador del cliente
(`perfil_cliente.html`), junto al enlace personal — visible siempre que
el cliente tenga token, no solo cuando ya se le ha firmado sesión hoy
(es la misma imagen todos los días, no hace falta generarla de nuevo).

Probado de punta a punta contra una base de datos temporal: el archivo
JS se sirve correctamente, el perfil de administrador incluye el bloque
del QR con la URL de confirmación correcta, y un `GET` directo a
`/mi/<token>/confirmar` (simulando el escaneo) confirma la sesión sin
duplicar nada en un segundo intento.

### Borrar un cliente, revirtiendo su economía (2026-07-29)

No existía forma de dar de baja a un cliente — Fernando lo pidió al
querer retirar los dos clientes de prueba creados ese día. Al mirarlo
apareció algo más urgente: sus 10 sesiones de prueba eran **el 100 % de
la facturación registrada de la semana en curso** (350 €, 10 horas, sin
ninguna sesión real todavía esa semana).

**Diseño**: `registrar_asistencia.eliminar_cliente_con_historial()` borra
primero cada sesión del cliente con `eliminar_sesion_pt()` (que ya
descuenta la facturación de la semana correspondiente usando la tarifa
histórica de cada sesión) y solo después su ficha, con
`clientes.repositorio.eliminar_cliente()`. Se hace sesión a sesión, en
vez de un `DELETE FROM clientes` directo, precisamente para no dejar su
dinero contado para siempre en `semanas`/`desglose` sin ninguna sesión
detrás — el descuadre silencioso que el sprint del 2026-07-28 se dedicó a
eliminar. Como salvaguarda, `eliminar_cliente()` se niega a borrar la
ficha si al cliente le queda alguna sesión en el historial.

En la web: enlace "Borrar este cliente" en su perfil →
`/cliente/<nombre>/eliminar`, una pantalla de confirmación que dice
cuántas sesiones se van a borrar y cuánto dinero se va a descontar antes
de tocar nada (misma regla que el resto de escrituras del proyecto) →
solo al confirmar se borra, y la portada informa de lo retirado.

**Bug de producción encontrado por estos tests**: `firmas_publicas.sesion_id`
(añadido horas antes, ver sección de la confirmación por QR) apunta a
`historial_sesiones.id`, así que borrar una sesión que el cliente ya
había confirmado fallaba con un error de clave foránea — y no solo al
borrar el cliente entero: **también al borrar a mano una sesión ya
confirmada desde el perfil de administrador**, algo que Fernando habría
encontrado en uso normal. Arreglado en `eliminar_historial()`, que ahora
borra la confirmación asociada dentro de la misma transacción. Es el
segundo caso del proyecto en que un test de una función nueva descubre un
fallo en una ya existente (ver lección del 2026-07-28).

### Protección del trabajo: responsabilidad de Claude, no de Fernando (2026-07-28)

Tras montar la copia de la base de datos, Fernando preguntó "¿si se me
rompe el ordenador, perdería la app?" — y dejó claro que proteger el
trabajo es responsabilidad de Claude como experto técnico, no una decisión
que él deba tomar o recordar pedir (no tiene conocimientos técnicos para
evaluarlo). Esto cambia una regla del proyecto: hasta ahora, Claude nunca
debía hacer `git commit`/`push` sin que Fernando lo pidiera explícitamente
cada vez — ahora Claude lo hace por iniciativa propia, como parte de
proteger el trabajo (ver excepción añadida en `.claude/CLAUDE.md`, sección
Reglas de Git). El resto de reglas de Git no cambian: nunca tocar `main`
directamente, nunca `push --force`, nunca mergear sin aprobación.

Estado de la protección a partir de ahora:
- **Código**: repositorio `github.com/Tatu-design/antifragil-sistema`
  (creado el 2026-07-28 para darle acceso a ChatGPT). **Público por decisión
  explícita de Fernando del 2026-07-30**, para que ChatGPT pueda auditarlo
  sin fricción — ver las reglas de qué no puede commitearse nunca en
  `.claude/CLAUDE.md`. Claude
  hace commit y push ahí regularmente sin necesidad de que Fernando lo pida.
  Límite honesto: esto depende de que haya una sesión de Claude Code activa
  — no hay ninguna tarea en la nube vigilando el ordenador de Fernando (las
  rutinas en la nube no tienen acceso al disco local, solo a repositorios ya
  subidos), así que el código nuevo queda protegido en cuanto se sube, no
  antes.
- **Datos** (`antifragil.db`): copia automática a Google Drive, ahora
  **diaria** (antes semanal, subido de frecuencia el mismo día tras esta
  conversación) a las 03:00, vía la rutina en la nube. Solo avisa por email
  (borrador de Gmail) si algo falla — si todo va bien no genera ningún
  correo, para no llenar la bandeja de borradores cada día.

### Copia de seguridad semanal a Google Drive (2026-07-28)

Fernando preguntó si los datos (sesiones, economía) quedan guardados para
siempre y si en 2028 se podría pedir un informe de 2026-2027 — sí, nada se
borra ni se resume con el tiempo, todo queda en `historial_sesiones` /
`semanas` / `desglose` indefinidamente. Pero hasta ahora todo vivía en un
único sitio: el archivo de la base de datos en el servidor de
PythonAnywhere, sin ninguna copia aparte. Para algo pensado para usarse
durante años, eso es un punto único de fallo real.

**Solución**: ruta nueva `/admin/backup` (protegida con el mismo
`admin_token` que el resto de rutas `/admin/*`) que entrega el archivo
completo de la base de datos. Una rutina en la nube (Claude Code routine,
`trig_01CKLkkC43B65EyCSCTquY5m`), programada cada domingo a las 23:00
(hora de Madrid), la descarga y la sube a una carpeta en Google Drive
("Copias de seguridad Antifragil"), con nombre `antifragil-AAAA-MM-DD.db`.
No se borran copias antiguas — el archivo pesa poco y así queda también un
histórico de "fotos" de los datos en distintos momentos, no solo la copia
más reciente.

La rutina termina creando un **borrador** de Gmail confirmando si la copia
salió bien o avisando si algo falló — así ni Fernando ni Claude tienen que
entrar a comprobar Drive cada semana a mano (decisión tomada tras que la
conexión de Google Drive de la sesión de chat se cayera y no hubiera forma
de verificarlo desde ahí: mejor que el propio sistema avise solo que
depender de comprobarlo manualmente). Solo puede crear un borrador, no
enviar el correo directamente — Fernando lo verá en Borradores, no en la
bandeja de entrada.

### Varias sesiones de PT el mismo día (2026-07-24)

El bloqueo de "no firmar dos veces el mismo día" de hace un rato resultó
ser demasiado estricto: Fernando necesita poder firmar más de una sesión
al mismo cliente el mismo día (p. ej. una sesión de regalo). El bloqueo no
era solo mío — venía de la propia estructura de la base de datos
(`UNIQUE(cliente, fecha)` en `historial_sesiones`, ahí desde el principio,
pensada para un caso que en la práctica no se cumple siempre: como mucho
una sesión de PT por cliente y día).

**Arreglo de fondo**: cada sesión pasa a identificarse por su propio `id`
(la clave que ya tenía la tabla), no por su fecha. Se quitó el `UNIQUE`
reconstruyendo la tabla (SQLite no permite quitarlo con `ALTER TABLE`,
así que se crea una copia sin él y se sustituye, conservando todos los
`id` y datos — migración automática en `basedatos.crear_esquema()`).
`editar_historial`/`eliminar_historial` (y sus rutas web) pasaron de
identificar la entrada por `(cliente, fecha)` a identificarla por `id` —
las URL de editar/borrar cambiaron de `/historial/<fecha>/editar` a
`/historial/<id>/editar`.

Como la protección real contra un doble toque accidental (la causa
original del descuadre de Pareja C) ya no puede venir de "una sesión
por día", se cambió el sitio donde vive esa protección: el botón "Firmar
sesión de hoy" se desactiva y cambia de texto nada más pulsarlo (en el
propio navegador, `perfil_cliente.html`), así un doble toque físico no
llega a mandar la segunda petición — pero una segunda sesión real, minutos
u horas después, se puede firmar sin problema.

### Avisos duplicados (2026-07-24)

Fernando vio el mismo aviso de "discrepancia económica" (el hueco conocido
de Cliente A, ver más abajo) repetido varias veces seguidas en Avisos. Causa:
la comprobación de sincronización se ejecuta en cada firma, y como el
hueco de Cliente A seguía sin resolver, cada sesión que se firmaba esa semana
(de cualquier cliente) volvía a detectarlo y creaba un aviso nuevo en vez
de reconocer que ya había avisado de lo mismo.

**Arreglo**: `registrar_aviso()` ahora no guarda un aviso si ya hay uno sin
resolver con el mismo tipo y el mismo texto exacto — aplica a todos los
tipos de aviso, no solo a este, así que también evita que se dupliquen
avisos de bono terminado o de discrepancia con Calendar si algo los
dispara más de una vez. Se resolvieron a mano los 2 avisos duplicados que
ya se habían creado, dejando solo uno.

### Verificación a fondo de la sincronización (2026-07-24)

A petición de Fernando, se probaron a propósito varios ciclos completos
(firmar → comprobar cliente + semana + mes → borrar → comprobar que todo
vuelve exactamente a como estaba) contra una copia de la base de datos
real, buscando huecos parecidos al de Pareja C. Aparecieron tres
reales, los tres arreglados:

1. **Firmar dos veces el mismo día para el mismo cliente sobrescribía la
   sesión en el historial (por el `UNIQUE(cliente, fecha)`) pero sumaba la
   economía dos veces** — probablemente la causa real del descuadre de
   Pareja C de ayer. Ahora `registrar_sesion_pt` lo detecta y rechaza
   con un mensaje claro ("ya tiene una sesión firmada ese día, edítala en
   vez de firmar otra vez") en lugar de dejarlo pasar en silencio.
2. **Borrar la sesión que completó un bono (y lo renovó automáticamente)
   no deshacía la renovación**: el cliente se quedaba marcado "pendiente de
   pago" de un bono que, según el historial que quedaba, nunca se había
   completado. Ahora, al borrar la sesión más reciente de un cliente si
   esa sesión era la que completaba el bono, se deshace también el
   "pendiente de pago". El perfil del cliente muestra un aviso cuando esto
   pasa.
3. **Las clases de grupo (CrossFit Lidomare/Kids) no se podían corregir**:
   a diferencia de las sesiones de PT, un toque de más en "+1 CrossFit
   Lidomare/Kids" no se podía deshacer de ninguna manera. Se añadió una
   tabla `clases_grupo` (fecha + tipo, igual que `historial_sesiones` para
   PT) y un botón "Deshacer última" para cada tipo en la pantalla de
   Economía. La comprobación automática de sincronización ahora también
   revisa Lidomare y Kids, no solo las sesiones de PT.

De paso, al probar el caso 3 apareció un **falso positivo** en la propia
comprobación de sincronización de ayer: la tarifa de Lidomare (15€) vive en
la misma tabla `desglose` que las de PT, así que cualquier clase de
Lidomare generaba una alarma falsa de "0 sesiones reales en el historial"
además de la comprobación correcta — se excluyó esa tarifa de la
comparación de PT, ya que se compara aparte contra `clases_grupo`.

Casos probados y confirmados correctos sin necesitar cambios: sumar/restar
una sesión de PT normal (cliente + semana + mes), y editar una sesión
trasladando su fecha a otra semana (la facturación se mueve de una semana
a la otra sin dejar rastro en la original).

### Descuadre económico y sincronización historial↔economía (2026-07-23)

Fernando reportó que sus propios números (620€/15h para la semana del
20-26 julio, 2.210€/53h acumulado en julio) no coincidían con lo guardado
en la app (740€/17h esa semana). Causa raíz: `semanas`/`desglose`
(el total económico semanal) y `historial_sesiones` (la lista de sesiones
firmadas) son dos tablas separadas que se mantienen a mano, cada firma /
edición / borrado suma o resta el importe correspondiente en operaciones
independientes (no una única transacción) — si algo se interrumpe a medio
camino, o se corrige un dato con una herramienta que no pasa por
`registrar_asistencia.py` (p. ej. un `DELETE` manual durante una reparación
de datos), la economía y el historial pueden quedar desincronizados sin que
nada lo detecte. Comprobado: Pareja C tenía 2 sesiones de más (120€)
contadas en la economía de esa semana sin fila correspondiente en el
historial — coincide exactamente con la diferencia que reportó Fernando.

**Arreglo del dato**: corregidas `semanas`/`desglose` de la semana del
2026-07-20 en el servidor (verificado antes de escribir, comparando con una
descarga fresca de la base de datos por si Fernando había firmado algo
mientras tanto). Los totales ahora coinciden exactamente con lo que
Fernando reportó.

**Arreglo de fondo** (para que esto no pueda volver a pasar sin que se
note el mismo día):

1. `historial_sesiones` guarda ahora la **tarifa** de cada sesión en el
   momento de firmarla (columna nueva, con backfill para las filas
   antiguas usando la tarifa actual de cada cliente). Antes había que
   fiarse de la tarifa *actual* del cliente para reconstruir cuánto debería
   sumar una sesión pasada — con esto queda fijado para siempre, aunque el
   precio cambie más adelante.
2. `economia.registro.verificar_sincronizacion_semana()`: recalcula, tarifa
   a tarifa, cuántas sesiones hay *de verdad* en el historial de una semana
   y lo compara con lo guardado en `desglose`. Nunca corrige nada por su
   cuenta — solo detecta y devuelve la diferencia.
3. Esta comprobación se dispara **sola, al momento**, cada vez que se firma,
   edita o borra una sesión de PT (`registrar_asistencia.py`) — si algo no
   cuadra, se guarda un aviso (`discrepancia_economica`) ese mismo día, en
   vez de que Fernando lo descubra semanas después comparando con su propia
   hoja de cálculo.
4. La verificación semanal contra Calendar (`/admin/verificar-semana`)
   ejecuta también esta comprobación como barrido periódico de las semanas
   recientes, además de la comprobación puntual de cada firma.

**Pendiente, no urgente**: la comprobación también señala que Cliente A tiene 2
sesiones (37,50€ cada una) contadas en la economía de la semana del 20-26
julio sin fila en el historial con fecha — pero esto coincide con lo que
Fernando cree correcto (también las contaba en su propia hoja), así que no
es un error económico, es un hueco de **historial** de antes del cambio a
firma manual (2026-07-22): esas 2 sesiones existieron pero nunca quedó
registrada la fecha exacta. No se ha tocado — si Fernando recuerda las
fechas, se pueden añadir para que el perfil de Cliente A muestre el historial
completo (hoy salta de la sesión 9 a la 12).

### Rendimiento: menos conexiones a la base de datos por petición (2026-07-24)

Tras el arreglo de rendimiento del 2026-07-23 (peso de archivos y caché),
Fernando siguió notando el botón "Firmar sesión" lento y las páginas
lentas al navegar entre ellas. Medido en local para contar operaciones,
no tiempo (PythonAnywhere gratuito ya tenía su propio suelo de ~1-1,5s por
petición, ver sección de abajo): firmar una sesión abría **10 conexiones
independientes** a SQLite en una sola petición (cargar el programa,
aplicar la actualización, guardar el historial, cargar tarifas, leer y
guardar la economía de la semana, más las 2 consultas de la comprobación
de sincronización añadida el día anterior); una página normal abría 4:
`hay_password_configurada()` en cada petición (vía `before_request`, para
comprobar algo que solo se configura una vez en la vida de la app),
`contar_no_leidos()` para el número de avisos del menú (en cada página),
y las consultas propias de la ruta.

Tres cambios, sin tocar ningún comportamiento visible:

1. **`hay_password_configurada()` en caché** (`webapp/auth.py`): se
   comprueba una vez y se guarda en memoria — la contraseña no cambia
   sola, así que no hace falta preguntarle a la base de datos en cada
   clic.
2. **Modo WAL en SQLite** (`basedatos.conectar()`): el modo por defecto
   bloquea todas las lecturas mientras hay una escritura en curso; en WAL
   pueden convivir. Se fuerza además `wal_autocheckpoint = 1` para que
   cada guardado se vuelque al momento al archivo principal
   (`antifragil.db`) — así sigue siendo un único archivo completo, sin
   depender también de un archivo auxiliar (`-wal`) que `sincronizar_servidor.py`
   o cualquier copia de diagnóstico tendría que acordarse de mover aparte.
   Comprobado en el servidor real tras desplegar: una escritura de prueba
   quedó en el archivo principal sin dejar ningún `-wal`/`-shm` suelto.
3. **Una consulta menos en la comprobación de sincronización** (añadida
   ayer): en vez de volver a leer el desglose de la semana que se acababa
   de guardar, se reutiliza el que ya se tenía en memoria.

Resultado local: firmar pasó de 10 a 9 conexiones (la mayor parte del
resto son escrituras reales, no repetidas — no hay mucho más margen sin
rehacer `registrar_asistencia.py` de raíz, algo no justificado ahora
mismo). El cambio con más impacto esperado es el modo WAL: quita el
bloqueo entre lecturas y escrituras, que es justo lo que más se nota
cuando alguien firma una sesión mientras otra persona (Fernando u otro
cliente mirando su enlace personal) está cargando una página al mismo
tiempo.

### Rendimiento de la web (2026-07-23)

Fernando notó la web lenta. Medido con peticiones reales al servidor, se
encontraron tres causas concretas (no relacionadas con el tamaño de los
datos, que es pequeño):

1. **Logo sobredimensionado**: 130 KB a resolución completa (3117×1089)
   para mostrarse como icono de ~40px en el menú. Redimensionado a 458×160
   → 24 KB (favicon.png igual, de 1089×1089 a 512×512).
2. **Sin caché en el navegador**: cada página volvía a descargar el CSS y
   el logo enteros, en vez de reutilizar lo ya descargado.
   `app.config["SEND_FILE_MAX_AGE_DEFAULT"]` puesto a una semana en
   `webapp/app.py` — estos archivos casi no cambian.
3. **Tipografía Lato cargada desde Google en cada visita** (`@import` a
   `fonts.googleapis.com`): un viaje de red externo de más, y un punto de
   fallo fuera de nuestro control. Descargados los 4 archivos reales
   (400/700, latin/latin-ext) a `webapp/static/fonts/` y servidos desde el
   propio servidor con `@font-face`, sin depender de Google.

**Límite honesto**: cada petición al servidor tarda ~1,2-1,5 segundos
independientemente del tamaño del archivo — parece ser el tiempo base del
plan gratuito de PythonAnywhere (CPU compartida), no algo arreglable desde
el código. Con caché, ese coste solo se paga en la primera visita; las
siguientes deberían notarse claramente más rápidas. Si el plan gratuito
sigue sin ir lo bastante rápido, el siguiente paso sería un plan de pago de
PythonAnywhere con recursos dedicados — no hace falta ahora, pero es la
opción si hiciera falta más adelante.

### Avisos de bono al firmar, y verificación semanal contra Calendar (2026-07-22)

Dos añadidos pequeños sobre el registro de asistencia:

- `registrar_asistencia.py` ahora avisa solo cuando pasa algo que merece
  atención: si la sesión firmada deja al cliente con 1 sola sesión
  (`aviso_ultima_sesion`) o si la renueva de golpe (`paso.renovado` — el
  bono se acaba de terminar y el nuevo queda pendiente de pago). Aparecen
  como avisos nuevos, con su contador en el menú.
- `verificar_semana.py` + ruta `/admin/verificar-semana` + skill
  `verificar-calendar`: Calendar pasa a ser una **comprobación**, no una
  fuente de datos — al final de la semana se compara lo firmado en la app
  con lo que de verdad hay en Calendar (sesiones que faltan por firmar,
  firmas sin evento correspondiente, clases de grupo con conteo distinto,
  eventos sin clasificar) y cualquier diferencia se guarda como aviso. Es
  de solo lectura: nunca corrige nada por su cuenta, ni sobre clientes ni
  sobre economía — eso queda siempre en manos de Fernando.

### Perfil público por cliente (2026-07-21, milestone 4 adelantado)

Cada cliente tiene ahora un enlace personal (`/mi/<token>`) de solo
lectura con su programa, sesiones restantes y estado de pago, y su
historial de sesiones con fecha — sin necesitar la contraseña de Fernando.

`token`: columna nueva en `clientes` (texto aleatorio único,
`secrets.token_urlsafe`), generada al crear el cliente; `asegurar_tokens()`
rellena el hueco a los clientes dados de alta antes de este cambio (se
llama sola al arrancar la web, segura de repetir). El enlace se ve y se
copia desde la pantalla de "Editar cliente".

Alcance deliberadamente pequeño: solo bono + historial de sesiones. El
historial de **pagos** (importes y fechas concretas) queda fuera — hoy el
sistema solo guarda "pendiente sí/no", no un registro de pagos individual;
sería una tabla y un flujo nuevos, aparcados como paso aparte si Fernando
los pide.

Requiere un archivo de configuración local con el token de la API de
Fernando (`datos/config_servidor.json` — usuario, token, dominio), fuera de
git (añadido a `.gitignore`) porque es una credencial real. Si ese archivo
no existe, `sincronizar()` simplemente no hace nada — el cierre semanal en
local sigue funcionando igual sin esto configurado, es un extra opcional,
no un requisito.

### Historial de sesiones por cliente (2026-07-20)

Fernando pidió poder ver, por cliente, en qué fecha hizo cada sesión y a
qué número de bono corresponde ("sesión 5 de 12, el 15 de julio") — para
comprobarlo él mismo y, más adelante, compartirlo con el propio cliente
(login por cliente, milestone 4, todavía sin construir).

Antes, `programas/procesar.py` solo sabía "esta semana, este cliente hizo
3 sesiones" (un conteo agregado) — la fecha exacta de Calendar se
descartaba nada más contarla. Ahora `calendar_integration/summary.py`
conserva la fecha de cada sesión, y `procesar_semana` las recorre una a
una (no de golpe) para poder etiquetar cada fecha con su número de bono —
incluyendo el caso de que una renovación caiga a mitad de semana (la
sesión que agota el bono se etiqueta como la última del bono viejo, no la
primera del nuevo). El resultado final por cliente (renovado, pendiente de
pago, sesiones restantes) es matemáticamente idéntico al cálculo agregado
de antes — se verificó con casos de prueba antes de dar el cambio por
bueno.

Tabla nueva `historial_sesiones` (`basedatos.py`), con `UNIQUE(cliente,
fecha)` para que repetir un cierre semanal actualice la entrada existente
en vez de duplicarla. Vista nueva en la web: `/cliente/<nombre>/historial`.

**Limitación conocida y aceptada:** no hay reconstrucción retroactiva de
fechas anteriores a este cambio — el primer cierre real (13-19 julio) ya
se había aplicado sin guardar fechas individuales. Se decidió no intentar
reconstruirlo a partir del estado actual (arriesgaba números incorrectos
si algo no cuadraba exactamente) — la página de historial muestra el
estado actual del cliente como punto de partida, y el registro fecha a
fecha empieza limpio desde el próximo cierre semanal en adelante.

## Stack técnico (decidido 2026-07-14, revisado el mismo día)

Fernando ya tenía Google Calendar conectado a Claude (conector de claude.ai),
así que no hace falta ningún código de autenticación propio: Claude lee el
calendario directamente a través de ese conector, ya autorizado.

| Pieza | Elección | Por qué |
|---|---|---|
| Lectura de Calendar | Conector `claude.ai Google Calendar` (ya autorizado) | Ya existe y funciona; construir una autenticación propia (OAuth/cuenta de servicio) habría sido complejidad innecesaria — ver lección en `.claude/skills/lessons-learned/log.md` |
| Clasificación de sesiones | Python puro, sin dependencias externas (`calendar_integration/parser.py`, `summary.py`) | Lógica determinista (no "a ojo" por IA) para que el conteo de sesiones sea siempre reproducible |
| Interfaz | Conversación con Claude Code (skill `resumen-semanal`) | No hace falta una app aparte: Fernando pide el resumen y Claude lo genera usando el conector + el script de clasificación |
| Base de datos de clientes/programas/economía | SQLite local `datos/antifragil.db` (`basedatos.py`, `sqlite3`) | Empezó como Excel (ver historia debajo); migrado por completo el 2026-07-18 para poder alojar la web app y evitar los problemas de Excel |

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

Nota técnica: tarifa y sesiones totales son fórmulas, no valores fijos.
Cualquier escritura por código (openpyxl) borra el valor cacheado de
**todas** las fórmulas del libro, no solo las tocadas — se detectó al
probar la edición desde la web app (2026-07-16). Para no depender de que
Fernando reabra Excel y pulse Ctrl+S cada vez, `leer_clientes()` recalcula
tarifa/sesiones_totales en Python contra la hoja "Programas" (valores
literales) cuando el valor cacheado viene vacío — el sistema funciona igual
sin intervención de Fernando. Sigue siendo buena idea que abra y guarde el
Excel de vez en cuando para que el propio archivo se vea correcto si lo
abre él.

Fernando también pidió (2026-07-15) anotar las sesiones consumidas del bono
actual en vez de las que quedan — le resulta más natural. La columna E del
Excel se llama **"Sesiones completadas"** (renombrada así el 2026-07-16;
antes se llamó "Sesiones llevadas"). `clientes/repositorio.py` convierte a
"restantes" (`sesiones_totales - sesiones_completadas`) solo para alimentar
`programas/procesar.py`, cuya lógica interna no cambió.

## Estructura de carpetas

```
antifragil/
  basedatos.py            # conexión y esquema SQLite compartidos (datos/antifragil.db)
  migrar_excel_a_sqlite.py  # migración de una sola vez, desde el Excel histórico
  calendar_integration/
    parser.py        # clasifica un título de evento (PT/CrossFit Lidomare/Kids)
    summary.py        # agrupa eventos clasificados en un resumen semanal
    semana.py           # calcula el rango lunes-domingo de una fecha
    resumen_cli.py       # CLI: recibe el array de eventos por stdin, devuelve resumen JSON
  programas/
    logica.py          # descuento y renovación de un programa individual
    procesar.py         # combina el resumen semanal con los programas actuales
  clientes/
    repositorio.py       # lee/escribe clientes y programas en SQLite
  economia/
    calculo.py           # facturación/horas/precio medio, desglosado por tarifa
    registro.py            # lee/escribe el histórico semanal/mensual en SQLite
    cli.py                  # consultas + registro de la facturación mensual de Kids
  cierre_semanal/
    cli.py                  # une Calendar + programas + economía (previsualizar / aplicar)
  webapp/
    app.py                  # web app Flask (proyecto de aprendizaje) — clientes + economía
  datos/
    antifragil.db            # base de datos real (nunca en Git)
  .claude/skills/resumen-semanal/SKILL.md   # paso 1: solo resumen de Calendar
  .claude/skills/cierre-semanal/SKILL.md     # pasos 3+4: flujo completo con confirmación
```

`calendar_integration/`, `programas/` y `economia/calculo.py` contienen solo
lógica pura (sin credenciales, sin llamadas de red). `clientes/repositorio.py`,
`economia/registro.py` y `basedatos.py` sí tocan disco, pero es un archivo
SQLite local del propio proyecto, no un servicio externo — la obtención de
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
3. Unir el paso 1 y el paso 2 en un solo skill semanal (`cierre-semanal`):
   leer Calendar, calcular, mostrar resumen y esperar confirmación de
   Fernando antes de escribir en `datos/clientes.xlsx`. ✅
4. Resumen económico semanal/mensual (`economia/`), como archivo local
   (`datos/facturacion.xlsx`) en vez de Google Sheets — mismo motivo que la
   base de datos de clientes (ver decisión del 2026-07-15 sobre Sheets). ✅

Cada paso debe verse funcionando antes de empezar el siguiente. La V1 según
el orden original está completa; quedan ajustes y pulido según el uso real.

## Próximos pasos técnicos pendientes de decidir

- Hacer el primer cierre semanal real con confirmación de Fernando
  (domingo 19 de julio de 2026), ya sobre SQLite
- Cuando termine julio 2026, registrar la facturación mensual de CrossFit
  Kids con `economia/cli.py kids`
- Milestone 3 de `webapp/` (ver `docs/APRENDIZAJE_WEBAPP.md`): elegir dónde
  alojar la web app ahora que ya no depende de un archivo Excel local

## Rendimiento de la app de Vercel: el coste que crecía solo (2026-08-08)

Fernando volvió a decir que la app iba lenta después de haberla optimizado.
Medir la app desplegada, y no el código en local, dio el diagnóstico:

- **La región no era el problema.** Las funciones corren en `cdg1` (París) y
  Supabase está en `eu-west-1` (Irlanda): unos 20 ms entre ellas. Se
  descartó.
- **El middleware tampoco.** Solo mira si existe la cookie, no toca la base.
- **El problema era Economía**, y era de los que empeoran solos: pedía los
  datos **mes a mes**, y cada mes costaba cinco viajes de red. Con tres meses
  eran 15 viajes; en diciembre habrían sido 60. Cada mes que pasara, la
  pantalla iría un poco más lenta sin que nadie tocara nada.

La solución es `datosDeTodosLosMeses()`: cinco consultas que traen sus tablas
enteras agrupadas por mes, y el reparto se hace en memoria. **Cinco viajes,
hoy y dentro de tres años.** Medido contra la base real: 15 consultas y
1842 ms → 5 consultas y 509 ms (3,6× más rápida).

Lo protege una prueba en `tests/rendimiento.test.ts` que no comprueba un
número fijo, sino que el coste **no cambia** al añadir veinte meses de
historia. Un presupuesto fijo se cumple hoy y se rompe solo en diciembre; esta
prueba no.

Segundo arreglo, en el pool de conexiones: abrir una conexión cuesta unos
700 ms (saludo TCP, cifrado y autenticación) antes de la primera consulta, y
se cerraba a los 10 segundos de inactividad. Cualquier pausa normal —mirar un
cliente, guardar el móvil, volver a los dos minutos— hacía pagar esos 700 ms
otra vez. Ahora aguanta un minuto, con `keepAlive`.

## Principios de arquitectura (de SYSTEM_VISION.md)

- Módulos independientes: Calendar, base de datos de clientes, resumen
  económico e interfaz no deben mezclarse en una sola pieza de código.
- Ninguna escritura en la base de datos de clientes sin confirmación previa
  del usuario (antes era "Notion o Sheets"; el principio es el mismo,
  cambió solo dónde vive el dato — ver decisión del 2026-07-15).
- Diseñada para escalar a futuros módulos (fisioterapia, nutrición, psicología,
  finanzas, etc.) sin rehacer la base.
