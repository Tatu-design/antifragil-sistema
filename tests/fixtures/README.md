# tests/fixtures — El contrato compartido de la migración

Esta carpeta contiene lo único que **Python y la futura versión de TypeScript
comparten literalmente**. No es código de ninguno de los dos: son datos.

## Los dos archivos

### `escenarios.json` — el contrato

38 escenarios. Cada uno dice: *parte de esta situación, haz estos pasos, y esto
es lo que tiene que quedar*.

```json
{
  "id": "E01",
  "regla": "Firmar una sesion descuenta exactamente una unidad",
  "pasos": [ ... ],
  "esperado": { "clientes": [...], "historial": [...], "meses": [...] }
}
```

Lo ejecuta `tests/motor_escenarios.py` contra el sistema Python. Cuando exista
la versión nueva, ejecutará **este mismo archivo** con su propio motor. Si las
dos fotografías coinciden, son equivalentes.

**Los resultados esperados están calculados a mano** desde las reglas de negocio
(3 sesiones × 45 € = 135 €), **nunca capturados de la salida del sistema**. Si se
capturasen, un fallo actual se convertiría en la especificación y la aplicación
nueva lo copiaría fielmente. Esto ya sirvió de algo: cuatro escenarios fallaron a
la primera y hubo que comprobar quién tenía razón — la tenía el sistema, y el
error estaba en el cálculo a mano.

Un escenario solo comprueba las secciones que declara. Uno que hable de meses no
tiene que enumerar todo el historial.

### `resultados_python.json` — la fotografía completa

Lo regenera la prueba `TestGenerarResultados` en cada ejecución. Guarda **todo**
el estado resultante de cada escenario, no solo lo que el escenario declara.

Sirve para dos cosas:

1. Comparar contra el archivo equivalente de TypeScript y detectar **efectos
   colaterales que nadie pensó en declarar** — que son justo los que se escapan.
2. Como red de seguridad del propio Python: si un cambio altera una cifra, sale
   en el `git diff` en términos de negocio («este mes pasa de 135 € a 90 €»), no
   como una prueba en rojo sin contexto.

Se versiona a propósito. Que cambie en un commit es información, no ruido.

## Reglas al añadir un escenario

1. **Datos ficticios siempre.** Solo `Cliente A`, `Cliente B`, `Cliente D`,
   `Pareja C`. Hay una prueba que lo impide activamente
   (`test_ningun_escenario_usa_datos_reales`) — el repositorio es público.
2. **Calcula el resultado a mano** antes de ejecutar nada.
3. **Un `id` único** y una `regla` que se entienda sin leer el JSON.
4. Si el escenario fija un comportamiento **dudoso**, añade un campo `nota`
   explicando que es un hallazgo abierto y no el comportamiento deseable (ver
   `E33` y `E34`).
5. No hace falta tocar Python: las pruebas se generan solas desde el archivo.

## Qué NO cabe aquí

Reglas que dependen del lenguaje o del servidor: autenticación, concurrencia,
atomicidad ante fallos, precisión en bruto de la coma flotante. Todo eso vive en
`tests/test_equivalencia_reglas.py` y habrá que reescribirlo en TypeScript, no
se reutiliza.
