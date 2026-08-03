# MIGRACION_NEXT_DECISIONES.md — Decisiones de arquitectura de la migración

> Cada decisión: qué se decide, por qué, qué se descartó y qué la ataría de
> nuevo. En lenguaje no técnico donde se puede — Fernando tiene que poder
> leerlas y discrepar.
>
> Rama: `feat/migracion-next-vercel` · Última actualización: 2026-08-03

---

## D-01 · La base de la migración es `feat/modalidades-servicio`

**Estado:** aceptada · **Decide:** Claude · **Confirma:** Fernando (2026-08-03)

El encargo inicial señalaba `feat/webapp-flask` como fuente de verdad. Al
comprobarlo resultó estar **42 commits por detrás** y ser antepasado directo de
`feat/modalidades-servicio`.

| Rama | Último commit | Situación |
|---|---|---|
| `main` | 15 jul 2026 | 64 commits por detrás |
| `feat/webapp-flask` | 28 jul 2026 | 42 por detrás, antepasado |
| **`feat/modalidades-servicio`** | **3 ago 2026** | **base real** |

**Qué habría pasado si no se detecta:** la aplicación nueva habría nacido sin
las tres modalidades de servicio, sin los estados de cliente, sin el rediseño
visual, sin la segunda auditoría de integridad y sin el cobro de servicios del
historial. Se habría descubierto meses después, con la app nueva ya construida.

**Condiciones comprobadas antes de aceptarla** (todas, el 2026-08-03):

- [x] Contiene todo el trabajo válido (es superconjunto exacto de las otras)
- [x] Las pruebas pasan — 245 en verde antes de tocar nada
- [x] No había cambios sin guardar
- [x] PythonAnywhere no se ha modificado
- [x] `feat/webapp-flask` sigue intacta, igual que `main`

**Documentación corregida:** `docs/APRENDIZAJE_WEBAPP.md`, que la presentaba
como la rama del proyecto. `.claude/CLAUDE.md` **no se ha tocado**: sus reglas
lo prohíben sin autorización expresa, y no la necesitaba.

---

## D-02 · Aplicación Next.js independiente, dentro de este repositorio

**Estado:** aceptada · **Decide:** Fernando (2026-08-03)

La aplicación nueva se construye como **aplicación Next.js autónoma**, no como
módulo de otro monorepo, y vive en este mismo repositorio en:

```
apps/control-entrenamiento-next/
```

**Por qué esa carpeta y no otra.** El proyecto Python vive hoy en la raíz
(`basedatos.py`, `webapp/`, `clientes/`…). Meter una aplicación de JavaScript en
la raíz mezclaría dos mundos que instalan, se construyen y se prueban de forma
distinta: el `node_modules` de uno junto a los módulos de Python del otro, dos
sistemas de dependencias compitiendo, y el riesgo real de que un comando pensado
para uno toque los archivos del otro. Con `apps/` la separación es física:

- Lo de Python sigue exactamente donde está. **Cero archivos movidos**, así que
  el despliegue a PythonAnywhere no cambia ni un paso.
- Vercel se configura para construir solo esa carpeta.
- Las dos aplicaciones comparten repositorio, historial y copias de seguridad,
  pero **no pueden romperse entre sí**.
- Si más adelante se traslada al repositorio de Guillermo, se mueve una carpeta
  entera y ya está — no hay que desenredar nada.

**Descartado:** módulo Vite dentro de un monorepo ajeno. Añade una dependencia
externa (el repositorio de otra persona) antes de haber demostrado siquiera que
la migración funciona, y los módulos de ese ecosistema **no tienen servidor
propio**, lo que complica justo la parte más delicada: las operaciones que
mueven dinero.

**Qué la ataría de nuevo:** que Guillermo confirme que la integración exige
desde el primer día compartir el mismo `host`. Se estudiará **después** de que
esta versión esté estable, no antes.

---

## D-03 · La lógica crítica vive en PostgreSQL, no repartida en TypeScript

**Estado:** aceptada · **Decide:** Claude (responsabilidad técnica delegada)

Firmar una sesión, renovar un servicio, borrar una sesión y mover economía se
implementan como **funciones dentro de la propia base de datos**, llamadas desde
el servidor de Next.js. No como código TypeScript que hace varias escrituras
seguidas.

**Por qué, sin tecnicismos.** Firmar una sesión no es una cosa: son cinco
(descontar del bono, escribir el historial, sumar a la semana, cerrar el bono si
se agotó, abrir el siguiente). O pasan las cinco o no pasa ninguna. Si se cae la
red a la mitad, no puede quedar la sesión escrita y el dinero sin sumar — ese
descuadre exacto ya ocurrió en julio de 2026 y costó una auditoría entera
arreglarlo.

La base de datos sabe hacer eso de forma nativa y **con garantías**. El código de
la aplicación solo puede aproximarlo. Además ya se usa ese principio aquí: hoy lo
que impide cobrar dos veces la misma mensualidad no es el código, es una regla de
la propia base de datos. Esto es extender lo que ya funciona.

**Ventaja añadida:** deja de importar si la pantalla acaba siendo Next.js o
cualquier otra cosa. La regla de negocio vive en un sitio y solo en uno.

**Descartado:** replicar las transacciones en TypeScript. Funciona, pero deja la
garantía en manos de que nadie olvide un `await` — y el historial de este
proyecto dice que ese tipo de fallo no lanza ningún error: solo enseña un número
equivocado.

**Lo que NO va en la base de datos:** los cálculos puros sin escritura (precio
efectivo, qué datos le faltan a un servicio, etiquetas de pantalla). Eso se porta
a TypeScript y se prueba contra las mismas fixtures que Python.

---

## D-04 · El diseño actual se mantiene tal cual

**Estado:** aceptada · **Decide:** Fernando (2026-08-03)

Se conserva el diseño claro y móvil actual («Liquid Glass»): fondo `#F5F7F4`,
acento `#1FA99A`, radios de 16 px, columna de 430 px, barra de pestañas inferior,
tipografía Geist e iconos Lucide incrustados.

**No** se migra al modo oscuro ni al estilo de ningún otro ecosistema. En esta
fase se busca **equivalencia**, no rediseño: si la pantalla cambia a la vez que
cambia el motor, es imposible saber si una diferencia es un fallo o una decisión.
La unificación visual se estudia después, y es de Fernando.

**Consecuencia práctica:** la aplicación nueva se compara con la actual pantalla
a pantalla, y cualquier desviación cuenta como defecto — igual que en el porte
del rediseño de agosto de 2026, donde medir contra el archivo original fue lo
único que destapó las desviaciones.

---

## D-05 · `guillevila/chat-af`: limitación documentada

**Estado:** limitación abierta · **Fecha:** 2026-08-03

**No se ha podido acceder al repositorio** desde este entorno. Comprobado por
tres vías distintas, todas el mismo día:

| Vía | Resultado |
|---|---|
| Consulta directa del repositorio | `404 Not Found` |
| Listado completo de repositorios de `guillevila` | no aparece |
| Búsqueda en la cuenta | no aparece |

La cuenta `guillevila` sí existe y es accesible. La explicación más probable es
que `chat-af` sea privado y el acceso disponible aquí (cuenta `Tatu-design`) no
lo alcance.

**Cómo se trabaja mientras tanto:** con el stack confirmado por Fernando —
Next.js 15, React 19, TypeScript, Tailwind CSS, Supabase, `@supabase/ssr`, Zod,
Radix UI, Lucide React. **No se inventa su estructura interna**: ni carpetas, ni
convenciones de nombres, ni organización de componentes.

**Sobre `alsari-capital-os`** (encontrado como público en la misma cuenta): queda
como **referencia secundaria** y nada más. No se traslada su arquitectura modular
ni sus decisiones de diseño. Se menciona en la auditoría porque explica cómo
construye Guillermo, no porque marque el camino de esta aplicación.

**Qué cerraría esta limitación:** acceso de lectura al repositorio, o que
Guillermo comparta su estructura de carpetas y sus convenciones.

---

## D-06 · Los escenarios de equivalencia son datos, no código

**Estado:** aceptada · **Decide:** Claude · **Fecha:** 2026-08-03

El contrato de la migración es un **archivo de datos** (`tests/fixtures/escenarios.json`)
que describe situaciones, pasos y resultados esperados. Python lo ejecuta con su
motor; la versión nueva lo ejecutará con el suyo.

**Por qué así y no dos suites de pruebas paralelas.** Dos suites escritas por
separado acaban comprobando cosas distintas sin que nadie lo note, y entonces
«las dos pasan» no significa que hagan lo mismo. Con un archivo compartido, la
pregunta «¿son equivalentes?» tiene una respuesta mecánica.

**Tres reglas que lo hacen fiable:**

1. **Los resultados esperados se calculan a mano** desde las reglas de negocio,
   nunca se capturan de la salida del sistema. Si se capturasen, un fallo actual
   se convertiría en la especificación y la app nueva lo copiaría fielmente.
   Esto ya demostró su valor: cuatro escenarios fallaron a la primera y hubo que
   comprobar quién tenía razón (la tenía el sistema — ver §Hallazgos abajo).
2. **La fotografía del resultado es determinista**: sin identificadores internos,
   sin horas de reloj, todo ordenado por claves de negocio.
3. **Los importes se comparan al céntimo**, que es la unidad del negocio. La
   precisión en bruto se vigila aparte, porque es justo lo que cambia al pasar de
   SQLite a PostgreSQL.

---

## Hallazgos abiertos que necesitan decisión de Fernando

Los dos aparecieron al escribir los escenarios de la Fase 3. **Ninguno se ha
corregido**: son comportamientos que afectan a lo que Fernando ve, así que la
decisión es suya. Los dos están fijados como escenarios (`E33`, `E34`) para que
la migración no los cambie sin querer.

### H-01 · Las sesiones de una mensualidad no suman horas en la vista semanal

Un cliente de mensualidad con 3 sesiones firmadas deja la semana en **0 € y 0
horas**. El mes sí las cuenta (720 € y 3 horas).

Lo del dinero es defendible: la cuota es mensual, no semanal. **Lo de las horas
no**: son horas realmente trabajadas y desaparecen de la pestaña «Semana». Es el
mismo tipo de hueco que se corrigió en la vista mensual el 2026-08-03.

*Efecto real:* si Fernando tiene clientes de mensualidad, el precio medio por
hora de la semana sale inflado y las horas semanales salen cortas.

*Propuesta:* sumar las horas a la semana aunque la sesión no lleve importe.
Requiere confirmación porque cambia una cifra que Fernando ya está mirando.

### H-02 · El cobro de un ciclo y el de su cuota mensual pueden contradecirse

Al configurar una mensualidad, el ciclo puede quedar marcado «pagada» mientras su
cargo de ese mismo mes queda «sin cobrar». El ciclo hereda el estado de la ficha
del cliente; el cargo nace siempre sin cobrar.

Marcar el pago a mano sí los deja de acuerdo (escribe en los tres sitios a la
vez). El camino automático, no.

*Efecto real:* la ficha puede decir «Mensualidad pagada» de un mes que no está
cobrado.

*Propuesta:* que al crear el ciclo de una mensualidad su estado de cobro salga
del cargo del mes, que es el que manda. Requiere confirmación por el mismo
motivo.
