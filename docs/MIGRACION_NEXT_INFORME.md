# Informe de migración a Next.js / Supabase / Vercel — para revisión externa

> Documento autocontenido, preparado para que una segunda opinión (ChatGPT) pueda
> auditarlo sin acceso al repositorio. Fecha: 2026-08-03.
> Repositorio público: `github.com/Tatu-design/antifragil-sistema`

---

## Contexto para quien lo lea desde fuera

**Qué es el sistema.** El sistema operativo interno de Antifrágil (Fernando Campos)
para gestionar su servicio de entrenamiento personal: clientes, bonos de sesiones,
firma de cada sesión desde el móvil justo al terminarla, renovaciones automáticas,
estado de cobro, economía semanal y mensual, clases de CrossFit, avisos, y un
enlace público (con QR) para que cada cliente confirme su propia sesión.

**Stack actual.** Python + Flask + plantillas Jinja + SQLite, alojado en
PythonAnywhere. ~10.200 líneas de Python, 40 rutas web, 14 plantillas, 13 tablas,
**245 pruebas automáticas en verde**. Está en uso real y diario.

**Qué se pide.** Migrarlo a Next.js + React + TypeScript + Tailwind +
Supabase/PostgreSQL + Vercel, para compartir stack, autenticación y datos con el
resto de aplicaciones del ecosistema. Con una condición innegociable: **es una
migración paralela, verificable y reversible**, no una reescritura. La app Flask
sigue siendo la oficial hasta que la nueva demuestre equivalencia total en datos,
lógica y resultados económicos.

**Qué se ha hecho hasta ahora.** Fase 0 (proteger el estado) y Fase 1 (auditoría
completa). Cero líneas modificadas de la aplicación en producción.

---

## 1. Estado real de la arquitectura actual

### 1.1 Corrección sobre la rama de partida

El encargo indicaba que la rama fuente de verdad era `feat/webapp-flask`. **No lo es.**

| Rama | Último commit | Situación |
|---|---|---|
| `main` | 15 jul 2026 | 64 commits por detrás |
| `feat/webapp-flask` | 28 jul 2026 | **42 commits por detrás** |
| **`feat/modalidades-servicio`** | **3 ago 2026** | **La real. Contiene todo lo demás** |

`feat/webapp-flask` es antepasado directo de `feat/modalidades-servicio`: no tiene
nada que la otra no tenga. Partir de ella habría dejado la app nueva **sin las tres
modalidades de servicio, sin los estados de cliente, sin el rediseño visual, sin la
segunda auditoría de integridad y sin el cobro de servicios del historial**.

La rama de migración se ha creado desde `feat/modalidades-servicio`.

### 1.2 Inventario resumido

| | |
|---|---|
| Código | ~10.200 líneas Python, 14 plantillas, **40 rutas** |
| Base de datos | SQLite, **13 tablas** |
| Pruebas | **245 en verde** (63,9 s) |
| Producción | PythonAnywhere, desplegado **subiendo archivos a mano por su API** |
| Copias de seguridad | Diaria a Google Drive vía rutina en la nube |
| Datos locales | 8 clientes, 47 sesiones, 3 semanas — **no son producción** |

La lógica está bien separada: `servicios/modalidades.py` contiene reglas puras sin
base de datos; `registrar_asistencia.py`, las operaciones atómicas;
`economia/registro.py`, el dinero. Eso hace la migración más viable de lo habitual.

### 1.3 Invariantes que el código lleva dentro tras cuatro auditorías

Lo relevante no es qué hace, sino **por qué está hecho así**:

- Firmar una sesión es **una sola transacción `BEGIN IMMEDIATE`**, incluida la
  lectura del estado. Sin eso, dos firmas simultáneas calculan el mismo número de
  sesión (bug real, corregido el 2026-07-30).
- Hay **cuatro capas anti-duplicado**: botón que se desactiva, clave de
  idempotencia de un solo uso por carga de página, `BEGIN IMMEDIATE`, y la clave
  primaria `(cliente, año, mes, concepto)` de `cargos_mensuales` — esta última lo
  impide **desde la base de datos**, no desde el código.
- La tarifa se congela en cada sesión y en cada ciclo. Nunca se recalcula con la
  tarifa actual del cliente.
- `pagado = NULL` **no es deuda**: es "nunca se registró".
- `tarifa = NULL` en una sesión significa "cuenta como hora trabajada, no suma
  dinero" (es el caso de las mensualidades).
- `sesiones_totales = 0` significa **sin límite**, no cero sesiones.
- Regla que atraviesa todo el proyecto:
  **dinero producido ≠ horas trabajadas ≠ dinero cobrado.** Marcar un ciclo como
  pagado solo cambia lo tercero.
- Las semanas anteriores al 2026-07-22 tienen **huecos reales conocidos** (sesiones
  cobradas cuya fecha nunca se registró), tapados con ajustes explícitos y visibles.
  La migración debe **reproducirlos, no arreglarlos**: arreglarlos cambiaría cifras
  ya cerradas y comunicadas.

### 1.4 Las tres modalidades de servicio

| | Cuándo se paga | Qué pasa al firmar | Cuándo renueva |
|---|---|---|---|
| **Bono** | Por adelantado, paquete de N sesiones | Descuenta 1 y suma su parte de dinero | Al agotarse |
| **Mensualidad** | Cuota fija a principio de mes | Suma **hora**, no dinero | Al cambiar de mes |
| **Cuenta de cliente** | Al final, por lo realmente hecho | Suma hora y su precio | Al cambiar de mes |

---

## 2. El repositorio de referencia — hallazgo relevante

**`guillevila/chat-af` no existe o no es accesible.** No se ha inventado su contenido.

Buscando en la misma cuenta aparece **`guillevila/Finanzas-GEAF`, que internamente
se llama `alsari-capital-os`** — "Sistema Operativo corporativo unificado del
holding Alsari Capital". Es público, está activo y es el patrón real con el que se
construye en ese ecosistema:

```
apps/host/          → Next.js 15 + React 19 + Supabase SSR + Tailwind 3.4
apps/modules/       → contabilidad, facturas, financiero, presupuestos
                      cada uno: Vite 5 + React 19 + Zod + Zustand + React Router
packages/           → ui, types, utils, supabase-client, config
services/supabase/  → migrations/ (40+ SQL versionados) + functions/
vercel.json         → despliega solo el host
```

Su ADR aceptado (`docs/decisiones/0001-stack-tecnico.md`) lo establece explícitamente:
**el host es Next.js; los módulos de negocio son SPA de Vite + React**, aislados con
Error Boundary para que un módulo roto no tire el resto. Supabase con **RLS
obligatorio en todas las tablas** y migraciones SQL versionadas.

**Esto contradice parcialmente la arquitectura objetivo del encargo** (que pedía
App Router, Server Components y Server Actions): un módulo Vite **no tiene servidor
propio** donde ejecutar Server Actions ni transacciones.

Nota: `chat-af` incluía Radix UI en su descripción, y Alsari no usa Radix. Es
posible que `chat-af` sea otro patrón distinto y que el hallazgo anterior no sea el
objetivo correcto.

---

## 3. Diferencias entre los dos proyectos

| | App de entrenamiento (hoy) | Alsari Capital OS |
|---|---|---|
| Forma | Una aplicación completa | Monorepo: un tronco + módulos |
| Servidor | Flask, todo en servidor | Host Next.js; **módulos sin servidor** |
| Datos | SQLite, un archivo | Supabase Postgres compartido |
| Usuarios | Una contraseña, ninguna cuenta | Supabase Auth con cuentas |
| Dinero | `REAL` (coma flotante) | `NUMERIC` en Postgres |
| Migraciones | Automáticas al arrancar (`ALTER TABLE` aditivos) | SQL versionado en archivos |
| Diseño | «Liquid Glass», claro, móvil, columna de 430px | «Quiet Luxury», **modo oscuro** |
| Despliegue | Archivos sueltos por API | Vercel desde Git |
| Acceso público sin login | Sí (`/mi/<token>` + QR) | No contemplado |

---

## 4. Riesgos principales

| # | Riesgo | Por qué importa |
|---|---|---|
| **R1** | **Los módulos del ecosistema no tienen servidor** | El encargo exige operaciones críticas en servidor y en transacción. Una SPA de Vite no puede. Hay solución (ver §5), pero exige decidir la forma primero |
| **R2** | Los datos vivos están en PythonAnywhere, no en local | Migrar desde la copia local sería migrar datos falsos. Debe partir de una descarga fresca de `/admin/backup` |
| **R3** | El despliegue actual no sigue a Git | Puede haber código commiteado que no está en producción. Ya tumbó la web el 2026-07-29 |
| **R4** | Los importes son coma flotante (`REAL`) | Al pasar a `NUMERIC` pueden moverse céntimos. Hay que comparar **sumas**, no solo recuentos |
| **R5** | El identificador del cliente **es su nombre** (clave primaria TEXT) | De él cuelgan historial, ciclos, cargos, confirmaciones y avisos. Migrar a un `id` estable es lo correcto técnicamente, pero el encargo prohíbe cambiar identificadores en silencio |
| **R6** | Dos fuentes económicas + huecos históricos conocidos | La vista semanal sale de un agregado guardado; la mensual, del historial real. Si la app nueva "arregla" los huecos, cambia cifras ya dadas por buenas |
| **R7** | SQLite y Postgres no se bloquean igual | `BEGIN IMMEDIATE` serializa a todos los escritores de la base entera. Postgres no. La garantía hay que reconstruirla (`SELECT ... FOR UPDATE` o `SERIALIZABLE`), no traducirla |
| **R8** | Los QR de los clientes ya están repartidos | Los tokens públicos no se pueden regenerar. Además RLS debe permitir acceso **anónimo por token** a un solo cliente sin exponer al resto |
| **R9** | Se pasa de una contraseña a cuentas de usuario | Cambia el flujo diario. Debe probarse en iPhone antes del cutover |
| **R10** | Uso real: firmar justo al terminar cada sesión | Un fallo no es una página rota: es una sesión sin registrar |
| **R11** | Acoplamientos concretos | SQL crudo de SQLite repartido en 4 archivos; `LIKE '2026-08-%'` y `substr()` sobre fechas de texto; esquema que se migra solo al arrancar |
| **R12** | Las 245 pruebas no lo ven todo | Ya se escaparon dos veces fallos que solo se ven en pantalla (una condición de plantilla borró el botón de firmar en 2 de 3 modalidades). **La paridad tiene que llegar hasta el HTML** |

---

## 5. Arquitectura objetivo recomendada

Con una desviación deliberada respecto a lo pedido:

**La lógica crítica no va en TypeScript. Va dentro de PostgreSQL.**

Firmar, renovar, borrar y mover economía se implementan como **funciones de
PostgreSQL** (`sign_session`, `renew_cycle`…) llamadas por RPC. Motivos:

1. **Resuelve R1 de raíz.** Da transacción real tanto si la pantalla acaba siendo
   Next.js como si acaba siendo un módulo Vite sin servidor. La decisión de forma
   deja de bloquear la de fondo.
2. La garantía atómica que hoy da `BEGIN IMMEDIATE` se **reproduce exactamente**,
   no se aproxima.
3. Es continuidad, no invento: hoy la clave primaria de `cargos_mensuales` ya impide
   cobrar dos veces el mismo mes **desde la base de datos**.

El resto:

- **Postgres** con `NUMERIC(10,2)` para dinero, `date` para fechas, RLS en todas las
  tablas, migraciones SQL versionadas, zona horaria `Europe/Madrid` explícita.
- **TypeScript** con la lógica pura portada (`servicios/modalidades.py` →
  `domain/modalidades.ts`), probada contra las **mismas fixtures** que Python.
- **React** solo pinta. Ningún componente calcula un bono ni una factura.
- **Enlace público del cliente**: función RPC anónima que resuelve el token en
  servidor. Nunca una consulta desde el navegador.

---

## 6. Plan por fases y estado

| Fase | Qué | Estado |
|---|---|---|
| 0 | Proteger el estado, copia de seguridad, rama nueva | ✅ **completada** |
| 1 | Auditoría completa (`docs/MIGRACION_NEXT_AUDITORIA.md`) | ✅ **completada** |
| 2 | Matriz de equivalencia | 🔒 **bloqueada** — depende de las decisiones de §7 |
| 3 | Blindar el Python actual con pruebas + fixtures compartidas | Siguiente. No depende de nada |
| 4 | Diseñar Postgres: migraciones, restricciones, índices, RLS, backups | Pendiente |
| 5 | Script de migración de datos idempotente (dry-run → informe de diferencias) | Pendiente |
| 6 | Construir la app en paralelo, sin retirar Flask | Pendiente |
| 7 | Portar la lógica a TypeScript/SQL, regla a regla | Pendiente |
| 8 | Pruebas de paridad Python ↔ nuevo sistema | Pendiente |
| 9 | Preview en Vercel con datos ficticios | Pendiente |
| 10 | Prueba controlada con Fernando | Pendiente |
| 11 | Cutover y rollback documentado | Solo con autorización expresa |

---

## 7. Decisiones abiertas que bloquean la Fase 2

| # | Pregunta | Por qué bloquea |
|---|---|---|
| **1** | ¿La app va como **módulo dentro del monorepo** o como **aplicación Next.js independiente**? | Cambia el 100% de la matriz de equivalencia. Módulo = Vite sin servidor. Independiente = Next.js con Server Actions |
| **2** | ¿Antifrágil y Alsari comparten proyecto de Supabase o son dos separados? | Decide si hace falta separación por organización desde el día uno |
| **3** | ¿Qué es realmente `chat-af`? (sin acceso) | Su stack incluía Radix UI, que Alsari no usa. Puede que el patrón correcto sea otro |
| **4** | El ecosistema es modo oscuro «Quiet Luxury»; la app actual es clara «Liquid Glass». El encargo pide *mantener el diseño actual* | Son incompatibles: hay que elegir |
| **5** | ¿Cómo entra un cliente sin cuenta (QR y `/mi/<token>`)? | El ecosistema no contempla acceso anónimo |

---

## 8. Fase 0 y 1 — lo ya ejecutado y verificado

| Paso | Resultado |
|---|---|
| Rama de partida | `feat/modalidades-servicio`, **sin cambios sin guardar** |
| Suite de pruebas | **245 en verde**, 63,9 s |
| Copia de la base de datos | `integrity_check: ok`, **0 claves rotas** |
| Rama nueva | `feat/migracion-next-vercel`, creada y subida |
| Auditoría | Commiteada (`54b6f36`) |
| Ramas Flask | Intactas. `main` sin tocar. Sin `push --force` |
| PythonAnywhere (producción) | **No se ha tocado nada** |
| Líneas modificadas de la app | **Cero** |

---

## 9. Qué se pide a la revisión externa

1. ¿Es correcta la decisión de poner la lógica crítica en **funciones de PostgreSQL**
   en vez de en TypeScript? ¿Hay una alternativa mejor que mantenga la atomicidad
   sin depender de si la pantalla es Next.js o Vite?
2. **R5 (el nombre como clave primaria)**: ¿migrar a un `id` estable manteniendo el
   nombre como columna única, o conservar el nombre como clave? ¿Qué riesgos tiene
   cada opción durante la migración de datos?
3. **R7 (concurrencia)**: ¿es suficiente `SELECT ... FOR UPDATE` sobre la fila del
   cliente para reproducir la garantía de `BEGIN IMMEDIATE`, o hace falta
   `SERIALIZABLE`?
4. **R4 (dinero)**: ¿qué comprobaciones concretas debería incluir el script de
   migración para garantizar que ningún importe se mueve al pasar de `REAL` a
   `NUMERIC`?
5. **R8 (acceso anónimo por token)**: ¿cuál es la forma segura de hacerlo en
   Supabase con RLS, sin exponer al resto de clientes ni usar la clave `service_role`
   en el navegador?
6. ¿Falta algún riesgo relevante en la lista de §4?
7. ¿El orden de fases es el correcto, o hay algo que debería adelantarse?
