# MIGRACION_NEXT_EQUIVALENCIA.md — El contrato de la migración

> Para cada regla del sistema actual: qué hace hoy, qué tiene que hacer la
> versión nueva, qué prueba lo demuestra y en qué estado está.
>
> **Nada se marca «validado» hasta que la prueba pasa en los dos sistemas
> con el mismo resultado.** Que la pantalla cargue, que Vercel despliegue o
> que las tablas existan no cuenta.
>
> Rama: `feat/migracion-next-vercel` · Actualizado: 2026-08-03
> Pruebas al cerrar la Fase 3: **339 en verde** (245 antes + 94 nuevas)

---

## Cómo leer esta matriz

**Estado** de cada regla:

| | Significado |
|---|---|
| 🔒 **Blindada** | Hay prueba sobre el sistema Python actual. El comportamiento está fijado y no se puede cambiar sin que salte |
| ⏳ **Pendiente** | Falta implementarla en la versión nueva |
| ✅ **Validada** | Implementada y con el **mismo** resultado en los dos sistemas |
| ⚠️ **Hallazgo** | El comportamiento actual está fijado, pero es dudoso y espera decisión de Fernando |

**Dónde vive cada prueba:**

- `E**` → escenario de datos en `tests/fixtures/escenarios.json`, ejecutado por
  `tests/test_paridad_escenarios.py`. **Estos los ejecutará también la versión
  nueva**, tal cual, sin traducir.
- `tests/test_equivalencia_reglas.py` → reglas que no caben en un archivo de
  datos (autenticación, concurrencia, atomicidad…). Habrá que reescribirlas en
  TypeScript, no reutilizarlas.
- El resto → suites que ya existían antes de la migración.

---

## 1. Las 20 reglas mínimas del encargo

| # | Regla | Comportamiento actual | Entrada | Salida / efecto | Prueba | Estado |
|---|---|---|---|---|---|---|
| 1 | Firmar descuenta exactamente una unidad | Solo en bono. Mensualidad y cuenta no consumen saldo | Cliente + fecha | `sesiones_completadas` +1, fila de historial, importe a la semana | `E01` | 🔒 |
| 2 | La última sesión activa la renovación | Al llegar a 0 se cierra el ciclo y se abre el siguiente | 4ª sesión de un bono de 4 | Ciclo 1 cerrado con fecha fin, ciclo 2 abierto | `E02` | 🔒 |
| 3 | La renovación conserva servicio y tarifa | Se copian etiqueta, tarifa, sesiones y precio total | Renovación | Ciclo nuevo idéntico en condiciones | `E03` | 🔒 |
| 4 | El programa nuevo queda pendiente de pago | Siempre. El que se cierra guarda su estado real | Renovación | Ciclo nuevo `pagado = false` | `E04` | 🔒 |
| 5 | Una pareja no consume dos veces | Una pareja es **una sola ficha**: la unicidad es estructural | Firma de la pareja | 1 sesión, 1 unidad, 1 importe | `E05` | 🔒 |
| 6 | Dos sesiones el mismo día | Permitido desde 2026-07-24. Se identifican por `id`, no por fecha | 2 firmas, misma fecha | 2 filas, números 1 y 2 | `E06` | 🔒 |
| 7 | Eliminar una sesión devuelve la unidad | Recalcula desde la última sesión que queda | Borrar la más reciente | `sesiones_completadas` −1 | `E07` | 🔒 |
| 8 | Eliminar una sesión corrige la economía | Descuenta con la tarifa **histórica** de esa sesión | Borrar | Semana y mes bajan su importe | `E08` | 🔒 |
| 9 | No hay firma duplicada accidental | Cuatro capas (ver §3) | Misma petición dos veces | 1 sola sesión | `E09` + `test_equivalencia_reglas` | 🔒 |
| 10 | Los totales semanales coinciden | Salen del agregado guardado. Una semana a caballo se muestra **entera** | Sesiones en dos semanas | Dos filas de semana correctas | `E10` | 🔒 |
| 11 | Los totales mensuales coinciden | Salen del historial por **fecha real**, no del lunes de la semana | Semana a caballo julio/agosto | Cada sesión a su mes | `E11` | 🔒 |
| 12 | El historial mantiene orden y fechas | El número de sesión sigue el orden de **firma**, no el de fecha | 3 firmas en desorden | Fechas intactas, números 1-2-3 por orden de firma | `E12` | 🔒 |
| 13 | CrossFit Lidomare contabiliza | Tarifa fija 15 €. Cada clase es una fila propia | 3 clases | 45 €, 3 horas, semana y mes | `E13` | 🔒 |
| 14 | CrossFit Kids contabiliza | Provisional hasta introducir el importe del mes. Precio = importe ÷ clases reales de **su** mes | 4 clases, luego 800 € | 200 €/clase, deja de ser provisional | `E14`, `E14b` | 🔒 |
| 15 | El enlace público solo muestra su cliente | El nombre sale del token, nunca de un campo del formulario | Token de A | Página de A sin rastro de B | `test_equivalencia_reglas` | 🔒 |
| 16 | La autenticación protege lo privado | Guardia global + CSRF en toda escritura | Sin sesión | Redirección a login, y nada escrito | `test_equivalencia_reglas` | 🔒 |
| 17 | Pausados y cancelados conservan todo | Estado y deuda son independientes | Pausar | Ficha, historial y economía intactos | `E17`, `E17b` | 🔒 |
| 18 | Los importes no sufren redondeo | Tarifa al céntimo. **Un bono factura por sesiones hechas, no por su precio total** | Bono de 100 € entre 3 | 3 × 33,33 = **99,99 €** | `E18`, `E18b` + `test_equivalencia_reglas` | 🔒 |
| 19 | Las operaciones críticas son atómicas | Una sola transacción `BEGIN IMMEDIATE` | Fallo provocado a mitad | Nada guardado | `test_equivalencia_reglas` | 🔒 |
| 20 | Un error intermedio no desincroniza | Comprobación historial↔economía tras cada operación | Tanda de firmas, clases y borrados | Cero discrepancias | `test_equivalencia_reglas` | 🔒 |

---

## 2. Reglas específicas pedidas para esta fase

| Regla | Comportamiento actual | Prueba | Estado |
|---|---|---|---|
| **Tarifa histórica congelada** | Cambiar la tarifa **no** reescribe las sesiones ya firmadas. Cada una conserva la suya | `E21` | 🔒 |
| **`pagado = NULL` no es deuda** | Significa «nunca se registró». Ni sale en la lista de deudas ni cuenta como ciclo pendiente | `E22` + `TestPagadoNuloNoEsDeuda` | 🔒 |
| **`pagado = false` sí es deuda** | Un ciclo cerrado y sin cobrar cuenta, aunque ya no sea el actual | `E22b` | 🔒 |
| **`tarifa = NULL`** | Cuenta como hora trabajada y **no** suma dinero. No es 0 € | `E23` + `TestTarifaNulaEsHoraSinDinero` | 🔒 |
| **`sesiones_totales = 0`** | Significa **sin límite**, no cero. Se puede firmar indefinidamente | `E24` + `TestSesionesTotalesCeroEsSinLimite` | 🔒 |
| **Ajustes anteriores al 22-jul-2026** | Se suman al mes y se muestran como **línea propia con su motivo**. Idempotentes | `E25`, `E25b` + `TestAjustesHistoricos…` | 🔒 |
| **Un mes que solo existe por su ajuste** | No desaparece del histórico | `TestAjustesHistoricos…` | 🔒 |
| **Renovación mensual por calendario** | Mensualidad y cuenta se renuevan al cambiar de mes, nunca por consumo | `E23b` | 🔒 |
| **Un cliente pausado no genera cuota** | No se inventan ingresos de quien ha dejado de entrenar | `E23c` | 🔒 |
| **Zona horaria Europe/Madrid** | Nunca se usa la fecha del servidor | `TestZonaHoraria` | 🔒 |

---

## 3. Las cuatro capas anti-duplicado, una a una

Esta es la garantía más delicada del sistema. Se comprueban **por separado**
porque cada una protege de una cosa distinta, y perder una sola no rompe nada
visible hasta que ocurre el caso concreto.

| Capa | De qué protege | Dónde vive hoy | Cómo se prueba | Estado | En la versión nueva |
|---|---|---|---|---|---|
| **1. Botón que se autodesactiva** | Doble toque físico en el móvil | Navegador (plantilla) | Se comprueba que la plantilla la sigue llevando | 🔒 | Se reimplanta en React |
| **2. Clave de idempotencia** | Reintento de red, dos pestañas | Tabla `firmas_idempotencia` | Misma clave → 1 sesión. Clave distinta → 2 sesiones | 🔒 | Igual, con clave única en Postgres |
| **3. `BEGIN IMMEDIATE`** | Dos firmas exactamente simultáneas | Transacción de SQLite | **Dos hilos firmando a la vez**: números 1 y 2, nunca repetidos | 🔒 | ⚠️ **No se traduce**: Postgres no serializa igual. Ver §5 |
| **4. Clave primaria de `cargos_mensuales`** | Cobrar dos veces el mismo mes | La base de datos | `INSERT` directo saltándose la app → error de integridad | 🔒 | Igual: clave primaria compuesta |

**La capa 3 es la única que no se puede copiar.** En SQLite, `BEGIN IMMEDIATE`
coge el bloqueo de escritura de **toda la base** antes de leer. PostgreSQL no
hace eso. Habrá que reproducir la garantía bloqueando la fila del cliente
(`SELECT ... FOR UPDATE`) dentro de la función que firma. La prueba de dos hilos
tiene que pasar igual — es el criterio de aceptación.

---

## 4. Correspondencia SQLite → PostgreSQL

Pendiente de la Fase 4. Aquí solo lo que **ya está decidido** porque afecta a la
equivalencia:

| Hoy (SQLite) | Destino (PostgreSQL) | Motivo |
|---|---|---|
| Importes `REAL` | `NUMERIC(10,2)` | Exacto al céntimo. La comparación tiene que dar lo mismo |
| Fechas `TEXT` ISO | `date` | Permite rangos reales en vez de `LIKE '2026-08-%'` |
| `pagado INTEGER` nulable | `boolean` **nulable** | ⚠️ **No poner `NOT NULL DEFAULT false`**: borraría la diferencia entre «no pagado» y «no se sabe» |
| `tarifa REAL` nulable | `numeric(10,2)` **nulable** | Igual: `NULL` ≠ `0` |
| `sesiones_totales = 0` | Se conserva el 0 | Significa «sin límite». Cuidado con cualquier condición que trate 0 como falso |
| `clientes.nombre` como clave | **Decisión abierta** | Ver riesgo R5 de la auditoría |
| Sin zona horaria | `timestamptz` + `Europe/Madrid` explícito | Vercel corre en UTC |

---

## 5. Lo que NO se puede reutilizar y hay que reescribir

Honestidad sobre el alcance real de la Fase 3: de las 94 pruebas nuevas,
**44 son reutilizables tal cual** (los escenarios, que son datos) y
**50 habrá que reescribirlas en TypeScript** porque prueban cosas que dependen
del lenguaje o del servidor.

| Familia | Pruebas | Por qué no se reutiliza |
|---|---|---|
| Escenarios de negocio | 38 escenarios + 6 de contrato | ✅ **Sí se reutilizan.** Son un archivo de datos |
| Autenticación y permisos | 9 | Hacen peticiones HTTP a Flask |
| Enlace público | 7 | Igual |
| Capas anti-duplicado | 5 | Una usa hilos de Python, otra SQL de SQLite |
| Atomicidad | 3 | Provocan fallos parcheando funciones de Python |
| Precisión de importes | 5 | Miran cómo guarda SQLite en concreto |
| Tri-estado del cobro, tarifa nula, sin tope | 15 | Llaman a funciones de Python directamente |
| Ajustes históricos | 6 | Igual |
| Zona horaria | 3 | Igual |

---

## 6. Hallazgos abiertos — fijados, no corregidos

Aparecieron al escribir los escenarios. **Están fijados como escenarios para que
la migración no los cambie sin querer**, pero afectan a lo que Fernando ve, así
que la decisión de corregirlos es suya. Detalle completo en
`docs/MIGRACION_NEXT_DECISIONES.md`.

| # | Qué pasa | Efecto real | Escenario | Estado |
|---|---|---|---|---|
| **H-01** | Las sesiones de una mensualidad no suman **horas** en la vista semanal (sí en la mensual) | El precio medio por hora de la semana sale inflado | `E33` | ⚠️ |
| **H-02** | El ciclo puede decir «pagada» mientras su cuota del mes dice «sin cobrar» | La ficha puede afirmar que un mes está cobrado cuando no lo está | `E34`, `E34b` | ⚠️ |

---

## 7. Reglas todavía SIN cubrir

Lo que la Fase 3 **no** ha blindado, dicho explícitamente para que no parezca que
está cubierto:

| Regla | Por qué falta | Cuándo toca |
|---|---|---|
| Avisos (creación, no duplicación, resolución por tipo) | Cubierto parcialmente por suites antiguas, sin escenario propio | Fase 7 |
| Verificación semanal contra Google Calendar | Depende de un conector externo; no es parte del núcleo económico | Fase 7, o se descarta |
| Copia de seguridad y restauración | La ruta actual entrega un archivo SQLite; en Supabase el mecanismo es otro | Fase 4 |
| Migración de esquemas antiguos | Deja de tener sentido: Supabase usa migraciones versionadas | Fase 4 |
| Rendimiento de pantalla en la versión nueva | No existe todavía nada que medir | Fase 6 |
| Equivalencia **visual** pantalla a pantalla | Requiere la app nueva delante | Fase 6 |
| Comportamiento en iPhone | Igual | Fase 6 y Fase 10 |
| Sincronización con PythonAnywhere | Desaparece con el cutover | Fase 11 |

---

## 8. Cómo se cierra cada fila

1. Se implementa la regla en la versión nueva.
2. Se ejecuta **el mismo** `escenarios.json` con el motor de TypeScript.
3. Se comparan las dos fotografías campo a campo. Cero diferencias.
4. Se compara además `tests/fixtures/resultados_python.json` con su equivalente,
   que recoge la fotografía **completa** de cada escenario — ahí salen los
   efectos colaterales que nadie pensó en declarar, que son los que se escapan.
5. Solo entonces la fila pasa a ✅ **Validada**.

Una diferencia sin explicar **bloquea el paso a producción**. No se ajusta el
resultado esperado para que cuadre: o se corrige la implementación nueva, o se
documenta por qué la diferencia es correcta y Fernando la aprueba.
