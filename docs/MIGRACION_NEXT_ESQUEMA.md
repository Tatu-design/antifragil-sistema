# MIGRACION_NEXT_ESQUEMA.md — De SQLite a PostgreSQL

> Fase 4. Correspondencia tabla a tabla y la decisión sobre el identificador
> del cliente.
>
> **Estado: escrito, no ejecutado.** No hay PostgreSQL ni Supabase disponibles
> en este entorno, así que el SQL está revisado de forma pero **no probado**.
> Debe ejecutarse contra un Supabase de staging antes de darlo por bueno.
> `services/supabase/migrations/` · 2026-08-03

---

## 1. El identificador del cliente

**Decisión: `uuid` interno y estable. El nombre pasa a ser un dato editable.**

Tus cuatro requisitos y cómo los cumple:

| Requisito | Cómo se cumple |
|---|---|
| No perder el historial | Cada cliente conserva sus sesiones y servicios, que ahora cuelgan del `uuid` en vez del nombre |
| Que sigan funcionando enlaces y QR | El `token` se copia **tal cual** y no se regenera nunca. Los QR impresos siguen valiendo |
| Renombrar sin romper nada | El nombre ya no es la clave: cambiarlo no toca ninguna relación. En SQLite esto violaba una clave foránea y necesitó un arreglo delicado |
| Auditable y reversible | Tabla `migracion_clientes`: por cada cliente, su nombre antiguo y su `uuid` nuevo |

**Por qué no conservar el nombre como clave.** Es lo que ya causó dos problemas
reales: renombrar rompía las referencias, y dos clientes no podían llamarse
igual ni por error. Con un `uuid`, el nombre queda como lo que es —una etiqueta
que Fernando puede cambiar— y se protege aparte con un índice único que no
distingue mayúsculas, para que no haya dos indistinguibles en pantalla.

**Cómo se revierte.** `migracion_clientes` permite reconstruir el archivo SQLite
original: para cada `uuid`, se sabe qué nombre tenía y, por tanto, a qué filas
del sistema antiguo corresponde cada sesión y cada ciclo.

---

## 2. Correspondencia tabla a tabla

Solo lo que necesita la primera vertical. El resto se añade en migraciones
posteriores.

| SQLite (hoy) | PostgreSQL | Qué cambia |
|---|---|---|
| `clientes` | `clientes` | Clave `uuid` en vez del nombre. `estado` pasa de texto a `enum`. Se añade `creado`/`actualizado` |
| `programas_cliente` | `ciclos` | Igual, con `modalidad` como `enum` y restricciones que impiden condiciones imposibles |
| `historial_sesiones` | `sesiones` | Clave `uuid`. `fecha` pasa de texto a `date` y `hora` a `time` |
| `cargos_mensuales` | `cargos_mensuales` | Igual. Misma clave primaria compuesta |
| `semanas` + `desglose` | `semanas` | Se simplifica: la primera vertical no necesita el desglose por tarifa. **Pendiente** al portar Economía |
| `firmas_idempotencia` | `idempotencia` | Igual |
| `programas` | — | **No se migra.** Era el catálogo global de bonos rápidos; desde las modalidades, cada cliente lleva sus condiciones en su ciclo |
| `configuracion` | — | Contraseña y claves pasan a variables de entorno y a Supabase Auth |
| `avisos`, `clases_grupo`, `facturacion_kids_mensual`, `ajustes_mensuales`, `firmas_publicas` | — | **Pendientes.** Van con Economía, CrossFit y el enlace público |

### Cambios de tipo que hay que vigilar

| Hoy | Destino | Riesgo |
|---|---|---|
| Importes `REAL` | `numeric(10,2)` | Puede mover céntimos. **El script de migración tiene que comparar sumas, no solo recuentos** |
| Fechas `TEXT` ISO | `date` | Una fecha mal formada que hoy pasa desapercibida, en Postgres falla al insertar. Es una mejora, pero hay que revisar el origen antes |
| `pagado INTEGER` nulable | `boolean` **nulable** | ⚠️ **No poner `not null default false`**: convertiría en deuda todo lo migrado de antes de agosto de 2026 |
| `tarifa REAL` nulable | `numeric(10,2)` **nulable** | Igual: `null` ≠ `0` |
| `sesiones_totales = 0` | Se conserva el 0 | Significa «sin límite». Cuidado con cualquier consulta que lo trate como tope |
| Sin zona horaria | Fecha de negocio en `Europe/Madrid` | Vercel corre en UTC |

---

## 3. Lo que ahora garantiza la base de datos

Cosas que hoy dependen de que el código no se equivoque y pasan a ser
imposibles por construcción:

- **Cobrar dos veces el mismo mes**: clave primaria `(cliente, año, mes, concepto)`.
- **Condiciones imposibles** (un bono con cuota mensual, una mensualidad con
  tope de sesiones): restricción `condiciones_coherentes`.
- **Una sesión sin servicio**: clave foránea `(cliente, ciclo)`.
- **Una semana que no vaya de lunes a domingo**: restricciones `empieza_en_lunes`
  y `semana_de_lunes_a_domingo`.
- **Dos firmas simultáneas con el mismo número**: `select ... for update` sobre
  la fila del cliente, dentro de `firmar_sesion()`.
- **Que un fallo a mitad deje la sesión escrita y el dinero sin sumar**: toda la
  operación es una función de PostgreSQL, y una función corre entera o no corre.

---

## 4. Seguridad

- **RLS activo en todas las tablas.** Sin políticas nadie ve nada, que es el
  punto de partida correcto.
- Hoy, quien ha iniciado sesión gestiona todo (un solo entrenador). Cuando haya
  más, las políticas se estrechan sin tocar la aplicación.
- `firmar_sesion()` es `security invoker`: corre con los permisos de quien la
  llama, así que RLS sigue aplicándose. **No** es `security definer`, que se
  saltaría la seguridad para todo el mundo.
- La clave `service_role` **nunca** lleva prefijo `NEXT_PUBLIC_`: solo la usa el
  script de migración, jamás el navegador.

---

## 5. El enlace público del cliente — pendiente y con cuidado

Es el único caso en que alguien **sin cuenta** accede a datos. No se resuelve
con RLS normal, porque no hay usuario contra el que comparar.

Diseño previsto: una función que recibe el token, resuelve el cliente en
servidor y devuelve **solo lo suyo**. El nombre del cliente sale siempre del
token, nunca de un campo del formulario — igual que hoy.

Va en su propia migración, junto a la pantalla que la usa.

---

## 6. Lo que falta antes de poder migrar datos reales

1. **Ejecutar este SQL** contra un Supabase de staging. No se ha podido probar.
2. **Script de migración** (Fase 5) con dry-run e informe de diferencias.
3. **`RepositorioSupabase`**, la implementación que sustituye a la de staging.
4. **Comparar** recuentos, sumas, bonos, sesiones e historial entre origen y
   destino. Una diferencia sin explicar bloquea el paso a producción.
