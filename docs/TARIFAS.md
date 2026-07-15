# TARIFAS.md — Tarifas y reglas económicas del sistema de entrenamiento personal

> Documento de negocio proporcionado por Fernando (2026-07-15). Estas son las
> reglas reales de precios, programas y colores de Google Calendar. No
> inventar ni modificar estos valores sin que Fernando lo pida.
>
> **Nota técnica:** el documento original menciona "Notion" como el lugar
> donde se consulta/edita el número de sesiones del programa activo. Esa
> decisión cambió el 2026-07-15 (ver `docs/ARQUITECTURA.md`): ese dato vive
> ahora en `datos/clientes.xlsx`. La regla de negocio es la misma, solo
> cambia dónde vive el dato.
>
> **Nota sobre los colores (aclarado por Fernando, 2026-07-15):** el color
> de cada evento en Calendar es solo orientativo para Fernando, no algo que
> el sistema necesite leer o interpretar. La tarifa y el número de sesiones
> de cada cliente se toman siempre de `datos/clientes.xlsx`, relacionando
> por nombre de cliente — el sistema no intenta deducir la tarifa a partir
> del color del evento.

## Regla general

Todos los eventos contabilizables duran 60 minutos.

Si un evento permanece en Google Calendar, se contabiliza. Si el evento se
elimina de Google Calendar antes del cierre, no se contabiliza.

Los colores de Google Calendar identifican la tarifa o modalidad económica
de la sesión. En los programas de entrenamiento personal, cada evento
válido consume 1 sesión del programa correspondiente.

---

## 1. CrossFit Lidomare

- Nombre exacto en Google Calendar: `CrossFit Lidomare`
- Color: Azul
- Precio por sesión: 15 €
- Duración: 60 minutos
- Consume programa de entrenamiento personal: No

Fórmula: `Producción CrossFit Lidomare = número de sesiones del mes × 15 €`

## 2. Entrenamiento personal — Tarifa de 45 €

- Patrón del evento: `PT + nombre del cliente`
- Color: Gris
- Precio por sesión: 45 €
- Tipo de cliente: Cliente nuevo
- Programa: 4 sesiones — Importe total: 180 €

## 3. Entrenamiento personal — Tarifa de 40 €

- Patrón del evento: `PT + nombre del cliente`
- Color: Amarillo
- Precio por sesión: 40 €

Programas posibles (el color no distingue cuál — hay que consultar el
programa activo del cliente en `datos/clientes.xlsx`):
- Cliente antiguo: 4 sesiones — 160 €
- Cliente nuevo: 8 sesiones — 320 €

## 4. Entrenamiento personal — Tarifa de 35 €

- Patrón del evento: `PT + nombre del cliente`
- Color: Morado
- Precio por sesión: 35 €
- Tipo de cliente: Cliente antiguo

Programas posibles (el color no distingue cuál — consultar el programa
activo del cliente):
- 8 sesiones — 280 €
- 16 sesiones — 560 €

## 5. Entrenamiento personal — Tarifa de 37,50 €

- Patrón del evento: `PT + nombre del cliente`
- Color: Naranja
- Precio por sesión: 37,50 €
- Tipo de cliente: Cliente nuevo
- Programa: 16 sesiones — Importe total: 600 €

## 6. Entrenamiento personal en pareja — Tarifa de 60 €

- Patrón del evento: `PT + alias conjunto de la pareja`
- Color: Verde
- Precio por sesión: 60 €
- Programa: 12 sesiones — Importe total: 720 €

La pareja funciona siempre como una única unidad: entrenan juntos, pagan
conjuntamente, comparten un único programa/contador/renovación. Cada evento
verde = 1 sesión consumida, nunca 2. 60 € de producción, nunca 120 €.

## 7. CrossFit Kids

- Nombre exacto en Google Calendar: `CrossFit Kids`
- Color: Rojo
- Precio por sesión: Variable (no es una tarifa fija)
- Duración: 60 minutos
- Frecuencia habitual: 2 sesiones/semana, ~8 sesiones/mes
- Consume programa de entrenamiento personal: No

Regla económica: a final de mes, Fernando introduce manualmente la
facturación total mensual. La app cuenta las sesiones de `CrossFit Kids` del
mes y calcula:

`Valor por sesión = facturación total mensual ÷ número de sesiones del mes`

Ejemplo: 450 € ÷ 8 sesiones = 56,25 €/sesión — este valor cambia cada mes,
nunca se guarda como tarifa fija.

---

## Tabla resumen

| Servicio o programa | Color | Precio/sesión | Sesiones del programa | Importe total |
|---|---|---:|---:|---:|
| CrossFit Lidomare | Azul | 15 € | No aplica | 15 €/sesión |
| PT cliente nuevo | Gris | 45 € | 4 | 180 € |
| PT cliente antiguo | Amarillo | 40 € | 4 | 160 € |
| PT cliente nuevo | Amarillo | 40 € | 8 | 320 € |
| PT cliente antiguo | Morado | 35 € | 8 | 280 € |
| PT cliente antiguo | Morado | 35 € | 16 | 560 € |
| PT cliente nuevo | Naranja | 37,50 € | 16 | 600 € |
| PT pareja | Verde | 60 € | 12 | 720 € |
| CrossFit Kids | Rojo | Variable | No aplica | Facturación mensual |

---

## Reglas comunes de los programas de PT

- Los programas se pagan por adelantado.
- Cuando queda 1 sesión: mostrar alerta.
- Cuando el programa llega a 0: marcar terminado, renovar automáticamente
  con el mismo número de sesiones, misma tarifa, mismo color; marcar el
  nuevo programa como "Pendiente de pago"; el cliente puede seguir
  consumiendo sesiones aunque el pago esté pendiente.
- Fernando confirma manualmente cuándo se ha recibido el pago.
- Si el cliente cambia de tarifa/programa, Fernando lo modifica a mano en
  `datos/clientes.xlsx`.
- La renovación automática solo se detiene si el cliente está marcado como
  cancelado o inactivo.

## Regla de identificación de clientes

Todos los PT empiezan exactamente por `PT + nombre o alias` (ej: `PT Nikki`,
`PT Felipe`, `PT Sunil y Neha`). Cada cliente/pareja tiene un único alias
exacto.

**Si no hay coincidencia exacta entre el título de Calendar y el alias
guardado: no adivinar, no descontar sesiones, mostrar una incidencia y pedir
revisión manual.** (Esto ya es, en esencia, lo que hace hoy
`programas/procesar.py` con la lista `sin_programa`.)
