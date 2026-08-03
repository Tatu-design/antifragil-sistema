# MIGRACION_NEXT_AUDITORIA.md — Qué hay hoy, exactamente

> **Fase 1 de la migración a Next.js/Supabase/Vercel.**
> Este documento describe la aplicación **actual** (Flask + SQLite + PythonAnywhere)
> con el detalle necesario para poder reconstruirla sin perder nada. No propone
> todavía cómo será la nueva: eso es la matriz de equivalencia (Fase 2).
>
> Fecha: 2026-08-03 · Rama: `feat/migracion-next-vercel`
> Base de código auditada: `feat/modalidades-servicio` (commit `5478483`)
> Estado de las pruebas al auditar: **245 en verde** (`python -m unittest discover -s tests -t .`)

---

## 0. Aviso previo sobre la rama de partida

El encargo indicaba que la fuente de verdad era `feat/webapp-flask`. **No lo es.**

| Rama | Último commit | Relación |
|---|---|---|
| `main` | 2026-07-15 | 64 commits por detrás |
| `feat/webapp-flask` | 2026-07-28 | 42 commits por detrás — es antepasado directo |
| **`feat/modalidades-servicio`** | **2026-08-03** | **la más reciente; contiene todo lo anterior** |

`feat/webapp-flask` es un antepasado de `feat/modalidades-servicio`, así que no
hay nada que rescatar de ella: todo su contenido está incluido. Migrar desde
`feat/webapp-flask` habría dejado fuera, entre otras cosas, las tres modalidades
de servicio, los estados de cliente, el rediseño visual completo, la segunda
auditoría de integridad y el cobro de servicios del historial.

**La rama de migración (`feat/migracion-next-vercel`) sale de
`feat/modalidades-servicio`.**

---

## 1. Inventario funcional

Rutas reales de `webapp/app.py` (40 rutas). Todas las de escritura llevan token
CSRF comprobado en `before_request`, salvo las de máquina (`/admin/*` con token),
que no usan cookie.

### 1.1 Autenticación y acceso

| Función | Ruta | Método | Notas |
|---|---|---|---|
| Alta de contraseña inicial | `/configurar-password` | GET, POST | Exige `ANTIFRAGIL_SETUP_TOKEN`. Sin él, una instalación nueva se la queda el primer visitante |
| Entrar | `/login` | GET, POST | Contraseña única, no hay usuarios. Hash en `configuracion` |
| Salir | `/logout` | GET | |
| Guardia global | — | `before_request` | Redirige a login todo lo privado; deja pasar `/mi/<token>`, `/login`, `/static`, `/admin/*` |

**No hay concepto de usuario.** Un solo operador (Fernando) y una sola contraseña.
Las cookies son `HttpOnly`, `SameSite=Lax` y `Secure` (desactivable con
`ANTIFRAGIL_COOKIES_INSEGURAS=1` para desarrollo local).

### 1.2 Clientes

| Función | Ruta | Método |
|---|---|---|
| Lista de clientes (portada) | `/` | GET |
| Perfil / ficha | `/cliente/<nombre>` | GET |
| Alta: formulario | `/cliente/nuevo` | GET |
| Alta: pantalla de confirmación | `/cliente/nuevo/confirmar` | POST |
| Alta: guardar | `/cliente/nuevo/guardar` | POST |
| Editar datos (nombre, estado) | `/cliente/<nombre>/editar-datos` | GET |
| Editar datos: confirmar | `/cliente/<nombre>/confirmar` | POST |
| Editar datos: guardar | `/cliente/<nombre>/guardar` | POST |
| Editar programa/servicio | `/cliente/<nombre>/editar` | GET |
| Editar servicio: confirmar | `/cliente/<nombre>/servicio/confirmar` | POST |
| Editar servicio: guardar | `/cliente/<nombre>/servicio/guardar` | POST |
| Borrar: pantalla de confirmación | `/cliente/<nombre>/eliminar` | GET |
| Borrar: ejecutar | `/cliente/<nombre>/eliminar/confirmar` | POST |

La lista tiene cuatro contadores que son también filtros (Activos, Pendientes de
pago, Pausados, Cancelados). **Los contadores muestran el total general y no
cambian al filtrar.** El filtrado ocurre en el navegador con atributos `data-`,
sin volver a consultar la base de datos.

### 1.3 Sesiones

| Función | Ruta | Método |
|---|---|---|
| Firmar sesión | `/cliente/<nombre>/firmar` | POST |
| Historial completo | `/cliente/<nombre>/historial` | GET |
| Editar una sesión | `/cliente/<nombre>/historial/<id>/editar` | GET, POST |
| Borrar una sesión | `/cliente/<nombre>/historial/<id>/eliminar` | POST |

Cada sesión se identifica por su `id`, nunca por `(cliente, fecha)`: un cliente
puede tener varias sesiones el mismo día.

### 1.4 Cobros

| Función | Ruta | Método |
|---|---|---|
| Marcar pago del ciclo en curso | `/cliente/<nombre>/pago` | POST |
| Marcar pago de un ciclo cualquiera | `/cliente/<nombre>/ciclo/<ciclo>/pago` | POST |

### 1.5 Economía y clases de grupo

| Función | Ruta | Método |
|---|---|---|
| Pantalla de economía (semana + meses) | `/economia` | GET |
| +1 clase de grupo hoy | `/clase/<tipo>/firmar` | POST |
| Deshacer última clase | `/clase/<tipo>/deshacer` | POST |

`<tipo>` solo admite `lidomare` o `kids`. La facturación mensual de Kids se
introduce desde la misma pantalla.

### 1.6 Enlace público del cliente

| Función | Ruta | Método |
|---|---|---|
| Perfil público | `/mi/<token>` | GET |
| Confirmar sesión de hoy | `/mi/<token>/confirmar` | **GET y POST** |

El `GET` es una excepción consciente a "un GET no tiene efectos": el QR que
Fernando enseña al cliente abre esa URL directamente. Es segura de repetir.

### 1.7 Avisos

| Función | Ruta | Método |
|---|---|---|
| Bandeja | `/avisos` | GET (marca todos como leídos al entrar) |
| Resolver uno | `/avisos/<id>/resolver` | POST |
| Resolver todos de un tipo | `/avisos/resolver-tipo` | POST |

Un contador de no leídos se inyecta en todas las pantallas
(`_inyectar_avisos_no_leidos`).

### 1.8 Administración (token de máquina, no contraseña)

| Función | Ruta | Método | Estado |
|---|---|---|---|
| Copia de seguridad | `/admin/backup` | GET | Activa. Usa `sqlite3.Connection.backup()` para una foto consistente |
| Verificar contra Calendar | `/admin/verificar-semana` | POST | Activa, solo lectura |
| Procesar día | `/admin/procesar-dia` | POST | **Responde 410. Desactivada a propósito** |

### 1.9 Fuera de la web (línea de comandos, no migran tal cual)

- `cierre_semanal/cli.py` — modo `aplicar` **bloqueado** (escribía bonos y
  sustituía el desglose de la semana).
- `economia/cli.py`, `calendar_integration/resumen_cli.py`, `verificar_semana.py`.
- `sincronizar_servidor.py` — sube la base de datos a PythonAnywhere por su API.
- Migraciones de una sola vez: `migrar_excel_a_sqlite.py`, `migrar_ciclo_bono.py`,
  `migrar_ajustes_legacy.py`, `migrar_programas_cliente.py`, `migrar_modalidades.py`.
- `comprobar_rendimiento.py` — puerta de rendimiento obligatoria antes de entregar.

---

## 2. Inventario de datos

13 tablas en `datos/antifragil.db`. Recuentos de la copia local del 2026-08-03
(**la copia local no es producción**: producción vive en PythonAnywhere).

### 2.1 `clientes` — 8 filas

| Columna | Tipo | Nulo | Notas |
|---|---|---|---|
| `nombre` | TEXT | no | **CLAVE PRIMARIA. El identificador del cliente es su nombre.** |
| `tipo_programa` | TEXT | no | FK → `programas(nombre)`. Puntero heredado |
| `sesiones_completadas` | INTEGER | no | Por defecto 0 |
| `pendiente_pago` | INTEGER | no | 0/1. Describe **solo el ciclo en curso** |
| `token` | TEXT | sí | Índice único. Enlace público `/mi/<token>` |
| `ciclo_bono` | INTEGER | no | Por defecto 1. Contador de renovaciones |
| `estado` | TEXT | no | `activo` \| `pausado` \| `cancelado` |

### 2.2 `programas` — 7 filas
Catálogo global de bonos rápidos: `nombre` (PK), `tarifa` (REAL), `sesiones_totales`.
Desde las modalidades es solo un **atajo de alta**, no la fuente de verdad.

### 2.3 `programas_cliente` — 8 filas — *la fuente de verdad del servicio*

PK compuesta `(cliente, ciclo_bono)`. Una fila por servicio contratado.

| Columna | Tipo | Notas |
|---|---|---|
| `cliente`, `ciclo_bono` | TEXT, INTEGER | PK |
| `tipo_programa` | TEXT | Etiqueta libre (aquí sí, sin FK) |
| `tarifa` | REAL, nulable | **Tarifa histórica**, congelada al contratar |
| `sesiones_totales` | INTEGER | |
| `fecha_inicio`, `fecha_fin` | TEXT, nulables | ISO |
| `pagado` | INTEGER, **nulable** | `NULL` = nunca se registró. **No es deuda** |
| `modalidad` | TEXT | `bono` \| `mensualidad` \| `cuenta` |
| `precio_total`, `cuota_mensual` | REAL, nulables | |
| `sesiones_referencia` | INTEGER, nulable | |
| `anio`, `mes` | INTEGER, nulables | Solo en modalidades mensuales |

### 2.4 `historial_sesiones` — 47 filas
`id` (PK autoincremental), `cliente` (FK), `fecha` (TEXT ISO), `tipo_programa`,
`numero_sesion`, `sesiones_totales`, `tarifa` (REAL **nulable** — nulo en
mensualidad), `ciclo_bono`, `hora` (TEXT, nulable).

**Ya no hay `UNIQUE(cliente, fecha)`**: se quitó reconstruyendo la tabla el
2026-07-24.

### 2.5 `cargos_mensuales` — 0 filas
PK `(cliente, anio, mes, concepto)`. **Esa clave primaria es lo que impide cobrar
dos veces el mismo mes** — lo impide la base de datos, no el código.

### 2.6 Economía agregada
- `semanas` (3 filas) — PK `fecha_inicio` (lunes). `facturacion_pt_lidomare`,
  `horas_pt_lidomare`, `sesiones_kids`, `facturacion_kids` (nulable).
- `desglose` (13 filas) — `id`, FK a `semanas`, `tarifa`, `sesiones`, `facturacion`.
- `facturacion_kids_mensual` (0) — PK `(anio, mes)`.
- `ajustes_mensuales` (0) — PK `(anio, mes, origen)`, con `motivo` obligatorio.

### 2.7 Registro y control
- `clases_grupo` (0) — `id`, `fecha`, `tipo` (`lidomare`\|`kids`).
- `avisos` (0) — `id`, `fecha`, `tipo`, `detalle`, `resuelto`, `leido`.
- `firmas_publicas` (0) — `id`, `cliente`, `fecha`, `hora`, `sesion_id` (FK a
  `historial_sesiones.id`).
- `firmas_idempotencia` (0) — `clave` (PK), `creado`.
- `configuracion` (3) — `clave`/`valor`. **Contiene el hash de la contraseña, la
  `secret_key` y el token de administración.**

### 2.8 Reglas implícitas del esquema (fáciles de perder al migrar)

1. **Todos los importes son `REAL`** — coma flotante. No hay tipo decimal.
2. **Todas las fechas son `TEXT` en ISO** (`AAAA-MM-DD`), sin zona horaria. Las
   consultas mensuales usan `LIKE '2026-08-%'` y `substr()`.
3. **`pagado = NULL` no es deuda.** Es "nunca se registró".
4. `tarifa = NULL` en una sesión significa "cuenta como hora, no suma dinero".
5. `sesiones_totales = 0` significa **sin límite**, no cero sesiones.
6. Borrar un cliente arrastra sus ciclos; renombrarlo los arrastra también.
7. La FK `clientes.tipo_programa → programas.nombre` impide poner ahí un nombre
   libre. Por eso la etiqueta del servicio vive en el ciclo.

---

## 3. Inventario de reglas de negocio

### 3.1 Las tres modalidades (`servicios/modalidades.py`)

| | Cuándo se paga | Qué pasa al firmar | Cuándo renueva |
|---|---|---|---|
| **Bono** | Por adelantado, paquete de N | Descuenta 1 y suma su parte de dinero | Al agotarse |
| **Mensualidad** | Cuota fija a principio de mes | Suma **hora**, no dinero | Al cambiar de mes |
| **Cuenta de cliente** | Al final, por lo hecho | Suma hora y su precio | Al cambiar de mes |

La regla que atraviesa todo el proyecto:

> **dinero producido ≠ horas trabajadas ≠ dinero cobrado.**
> Marcar un ciclo como pagado solo cambia lo tercero. Nunca lo primero ni lo
> segundo, ni hacia adelante ni hacia atrás.

**Validaciones que rechazan combinaciones imposibles** (`validar_condiciones`):
un bono no lleva cuota mensual; una mensualidad no lleva número de sesiones que
se consuma; una cuenta no lleva ni cuota ni tope. En un bono, **el precio por
sesión no se pide: se calcula** (`precio_total / sesiones`), para que no pueda
contradecir al precio total.

### 3.2 Firmar una sesión (`registrar_sesion_pt`)

Todo dentro de **una única transacción `BEGIN IMMEDIATE`**, incluida la lectura
del estado. Orden exacto:

1. `asegurar_ciclo_mensual` — si es mensual y cambió el mes, abre el ciclo nuevo.
2. Leer el ciclo en curso **dentro** de la transacción bloqueante.
3. Validar que la modalidad tiene sus datos completos, o error con mensaje concreto.
4. `tarifa_de_la_sesion` — `None` en mensualidad.
5. Calcular el número de sesión:
   - Bono: `procesar_una_sesion`. Si agota el bono, el número es **el total**
     (última del bono viejo), no la primera del nuevo.
   - Mensualidad/cuenta: contar las del ciclo y sumar 1.
6. Comprobar `clave_idempotencia`; si ya existe, devolver el estado sin tocar nada
   y marcar `duplicado: True`.
7. Descontar el bono, crear/actualizar la ficha del ciclo, guardar el historial
   (con hora), sumar a la economía de la semana.
8. Si renovó: cerrar el ciclo con fecha de fin y estado de pago, abrir el
   siguiente con las mismas condiciones, **pendiente de pago**.
9. Avisos: `bono_terminado` o `ultima_sesion`.
10. **Fuera** de la transacción, ya confirmada: comprobar la sincronización
    historial↔economía y crear aviso `discrepancia_economica` si no cuadra.

### 3.3 Renovación
- **Solo los bonos renuevan por consumo.** Mensualidad y cuenta renuevan al
  cambiar de mes (`asegurar_ciclo_mensual`, idempotente, corre dentro de la misma
  transacción que la firma).
- La renovación **conserva programa, tarifa, sesiones y precio total**.
- El ciclo nuevo **nace pendiente de pago**.
- `asegurar_ciclo_mensual` se dispara al arrancar la web y al abrir la lista de
  clientes. **Nunca desde Economía**: consultar una pantalla no debe escribir.
- Un cliente **pausado o cancelado no genera cuota mensual**.

### 3.4 Editar y borrar sesiones
- **Bloqueo duro:** no se puede editar ni borrar una sesión de un ciclo cerrado
  si existen sesiones de ciclos posteriores. Devuelve un mensaje que dice cuántas
  y qué hacer. Se eligió bloquear en vez de recalcular en silencio.
- Al editar, si la fecha cambia de semana, la economía se traslada de una a otra
  **usando la tarifa histórica de la propia sesión**, nunca la actual.
- Al borrar la sesión más reciente de un ciclo que **completaba** el bono: se
  devuelve `clientes.ciclo_bono` al ciclo anterior **antes** de recalcular, y se
  deshace el "pendiente de pago". Sin ese orden el recálculo mira el ciclo nuevo
  (vacío) y pone 0.
- Borrar una sesión ya confirmada por el cliente borra también su confirmación,
  dentro de la misma transacción.

### 3.5 Borrar un cliente
Se borra **sesión a sesión** con `eliminar_sesion_pt` (que descuenta la
facturación con la tarifa histórica de cada una), de la más reciente a la más
antigua, y solo después la ficha. `eliminar_cliente` **se niega** si queda alguna
sesión. La pantalla dice antes cuántas sesiones y cuánto dinero se va a descontar.

### 3.6 Parejas
Una pareja es **un solo cliente** con un solo nombre. Comparten programa,
consumo, pago y renovación. No hay código específico: la unicidad viene de que
son una única fila.

### 3.7 CrossFit
- **Lidomare**: tarifa fija `15,0 €` (`TARIFA_CROSSFIT_LIDOMARE`). Cada clase es
  una fila en `clases_grupo` y suma a la economía como una sesión más de esa tarifa.
- **Kids**: se cuentan las clases; la facturación mensual la introduce Fernando.
  El precio por clase es `importe del mes / clases reales de ese mes`.
  **Cada clase se valora al precio de SU mes** y se suma a la semana que de
  verdad la contiene, así que una semana a caballo entre julio y agosto suma la
  parte de cada mes por separado.
  Mientras falte el importe, semana y mes se marcan `provisional`, y sus horas
  **no** cuentan (si contaran, el precio medio por hora saldría inflado).

### 3.8 Economía — dos caminos distintos, a propósito

| | Vista SEMANAL | Vista MENSUAL |
|---|---|---|
| Fuente | `semanas` + `desglose` (agregado guardado) | `historial_sesiones` + `clases_grupo` (fecha real) |
| Agrupación | Por el lunes de la semana | Por el mes real de cada fila |
| Cruce de meses | Muestra las dos juntas — **es lo correcto aquí** | Cada sesión a su mes |

El mes suma: sesiones con importe + cuotas mensuales + Lidomare + Kids (si hay
importe) + ajustes explícitos. Las **horas** cuentan **todas** las sesiones
firmadas, lleven importe o no.

`ajustes_mensuales` conserva facturación real anterior al registro de fechas
(2026-07-22) que el cálculo desde el historial no puede ver. **Se muestra como
línea propia con su motivo, nunca oculta dentro del total.**

### 3.9 Prevención de duplicados — cuatro capas
1. El botón se desactiva al pulsarlo (evita el doble toque físico).
2. `clave_idempotencia`, de un solo uso por carga de página (evita reintento de
   red y dos pestañas).
3. `BEGIN IMMEDIATE` (evita dos firmas simultáneas con el mismo número).
4. PK `(cliente, anio, mes, concepto)` en `cargos_mensuales` (evita cobrar dos
   veces el mes, aunque lleguen diez peticiones a la vez).

### 3.10 Enlace público y permisos
- El token resuelve el nombre del cliente. **Nunca se lee el cliente de un campo
  del formulario.**
- El cliente **jamás crea una sesión**: solo confirma una que Fernando ya firmó.
  Sin sesión de Fernando, no hay botón. Confirmar no toca bono, historial ni
  economía — es matemáticamente imposible que duplique nada.
- La confirmación es **por sesión** (`sesion_id`), no por día.
- Editar y borrar son solo de Fernando.
- Firmar está bloqueado en **dos niveles**: la interfaz oculta el botón y la ruta
  POST comprueba el estado igualmente (409). Esconder un botón no impide llamar
  a la ruta.

### 3.11 Zona horaria
`zona_horaria.py` centraliza `hoy_negocio()` / `ahora_negocio()` en
**Europe/Madrid**. Nunca se usa `date.today()` directamente: si el servidor corre
en UTC, entre medianoche y las 1-2 de la madrugada en Madrid firmaría con la
fecha de ayer. Requiere el paquete `tzdata`.

---

## 4. Riesgos

Ordenados por lo que pueden costar si se ignoran.

### R1 · El ecosistema no está construido como la arquitectura objetivo del encargo
**Bloqueante para la Fase 2.** Ver punto 3 del informe. El monorepo de referencia
construye los módulos de negocio como **SPA de Vite + React**, sin servidor
propio; solo el *host* es Next.js. Un módulo así no tiene dónde ejecutar Server
Actions ni transacciones. Requiere decisión antes de escribir la matriz.

### R2 · Los datos vivos NO están en este ordenador
Producción es PythonAnywhere. La copia local tiene 8 clientes y 47 sesiones, pero
**no es la verdad**. Toda migración de datos debe partir de una descarga fresca de
`/admin/backup`, nunca de `datos/antifragil.db` local.

### R3 · El despliegue actual no sigue a Git
Se despliega subiendo archivos sueltos por la API de PythonAnywhere. Un cambio
puede estar commiteado y **no** estar en producción — pasó el 2026-07-29 y tumbó
la web. Antes del cutover hay que comprobar qué versión corre de verdad.

### R4 · Importes en coma flotante
Todo es `REAL`. Postgres debe usar `NUMERIC(10,2)`. La conversión puede mover
céntimos: **hay que comparar sumas antes y después, no solo recuentos**.

### R5 · El identificador del cliente es su nombre
`clientes.nombre` es la clave primaria y de ella cuelgan historial, ciclos,
cargos, confirmaciones y avisos. Renombrar ya provocó un bug real que necesitó
`PRAGMA defer_foreign_keys` + `BEGIN` explícito. En Postgres lo natural es un
`id` estable — pero el encargo prohíbe cambiar identificadores en silencio.
**Decisión a documentar, no a improvisar.**

### R6 · Dos fuentes económicas y huecos históricos conocidos
La semanal sale de un agregado guardado; la mensual, del historial. Las semanas
anteriores al 2026-07-22 tienen **huecos reales** (sesiones cobradas sin fecha
registrada) tapados con `ajustes_mensuales`. La paridad Python↔TypeScript debe
**reproducir esos huecos, no arreglarlos**: "arreglarlos" cambiaría cifras ya
cerradas y comunicadas.

### R7 · Concurrencia: SQLite y Postgres no se comportan igual
`BEGIN IMMEDIATE` serializa a todos los escritores de la base entera. Postgres no
hace eso. Reproducir la garantía exige bloqueos explícitos por fila
(`SELECT ... FOR UPDATE`) o `SERIALIZABLE`, decidido regla a regla.

### R8 · Los tokens públicos no se pueden regenerar
Los clientes tienen su enlace y su QR. Regenerarlos rompería los QR ya
repartidos. Además, RLS debe permitir acceso **anónimo por token** a un solo
cliente sin exponer a los demás — no es el caso típico de RLS por usuario.

### R9 · Autenticación sin usuarios
Hoy hay una contraseña, no cuentas. Supabase Auth introduce cuentas donde no las
había. Es una mejora, pero **cambia el flujo diario de Fernando** y debe probarse
en el móvil antes del cutover.

### R10 · Cero tolerancia a interrupciones
El uso real es firmar desde el móvil justo al terminar cada sesión. Un fallo no
es "una página rota": es una sesión que no queda registrada.

### R11 · Acoplamientos concretos a desatar
- SQL crudo de SQLite repartido en `clientes/repositorio.py` (1.249 líneas),
  `economia/registro.py`, `registrar_asistencia.py` y el propio `webapp/app.py`.
- `LIKE '2026-08-%'` y `substr()` sobre fechas de texto — en Postgres son
  `date_trunc` / rangos.
- El esquema se migra solo al arrancar (`crear_esquema()` con `ALTER TABLE`
  aditivos). Supabase usa migraciones SQL versionadas: modelo distinto.
- `sincronizar_servidor.py` y `/admin/backup` desaparecen tal cual.

### R12 · Lo que las pruebas actuales NO cubren
245 pruebas en verde, pero el proyecto ya se llevó dos sustos que ninguna vio:
una condición de plantilla que borró el botón de firmar en dos modalidades, y
tres fallos en las costuras entre guardar, leer y pintar. **La paridad no puede
comprobarse solo a nivel de funciones: tiene que llegar hasta la pantalla.**

---

## 5. Qué NO se toca durante toda la migración

- La aplicación Flask de PythonAnywhere sigue siendo la oficial.
- No se apaga, no se modifica destructivamente, no se cambia su dominio.
- No se borra la rama `feat/webapp-flask` ni ninguna otra.
- No se hace `push --force` ni se reescribe historia.
- No se sube ninguna base de datos con datos reales al repositorio (el repositorio
  es **público**).
- No se usan nombres reales de clientes en pruebas ni en documentación.
