---
name: cierre-semanal
description: Flujo semanal completo — lee Calendar, calcula sesiones/renovaciones/pagos/facturación con la base de datos de clientes, muestra un resumen y solo escribe (Excel de clientes + registro económico) si Fernando confirma explícitamente.
---

# Skill: Cierre semanal

Implementa los pasos 3 y 4 de la V1 (`docs/ARQUITECTURA.md`): unir la
lectura de Calendar con la lógica de programas y el cálculo económico, y
actualizar `datos/clientes.xlsx` + `datos/facturacion.xlsx` **solo con
confirmación explícita de Fernando**. Nunca escribir sin ese paso — es una
regla de seguridad no negociable del proyecto.

## Pasos

1. Calcular el lunes y el domingo de la semana pedida (o la semana actual
   si no se especifica).
2. Llamar a `mcp__claude_ai_Google_Calendar__list_events` con
   `calendarId: fcmarcos12@gmail.com`, el rango lunes–domingo en
   `Europe/Madrid`, `orderBy: startTime`. (Ver `resumen-semanal` para más
   detalle de este paso — es el mismo.)
3. Guardar el array `events` devuelto **tal cual** (nunca retipeado a mano)
   en un archivo, p. ej. `eventos_semana.json`.
4. Ejecutar, desde la raíz del proyecto:
   ```
   .venv/Scripts/python.exe -m cierre_semanal.cli previsualizar 2026-07-13 < eventos_semana.json
   ```
   (el argumento de fecha es cualquier día de esa semana; si se omite, usa
   hoy). Esto NO escribe nada — solo calcula, usando los datos actuales de
   `datos/clientes.xlsx`.
5. Presentar el resultado a Fernando en una tabla clara:
   - Por cliente: sesiones consumidas esta semana, sesiones completadas
     nuevas, si se renueva el bono, si queda pendiente de pago, aviso de
     "última sesión".
   - Económico: facturación total, horas totales y precio medio por hora
     (desglosado por tarifa, igual que la hoja que ya llevaba Fernando).
     CrossFit Kids se cuenta en sesiones pero **no entra en la facturación
     de la semana** hasta que Fernando indique el importe mensual (ver
     comando `kids` más abajo).
   - `sin_programa`: nombres detectados en Calendar que no coinciden con
     ninguna fila del Excel — pedir revisión (puede ser un alias distinto,
     un cliente nuevo sin dar de alta, o un error de escritura).
   - `incompletos_datos`: clientes del Excel a los que les falta tipo de
     programa o sesiones completadas.
6. **Esperar la confirmación explícita de Fernando** antes de continuar.
   Si hay `sin_programa` o `incompletos_datos`, dejarlo claro y no asumir
   nada por él.
7. Solo si confirma, ejecutar:
   ```
   .venv/Scripts/python.exe -m cierre_semanal.cli aplicar 2026-07-13 < eventos_semana.json
   ```
   (misma fecha y mismo archivo de eventos que en el paso 4, para
   garantizar que se escribe exactamente lo que se previsualizó). Esto
   actualiza `datos/clientes.xlsx` Y registra la semana en
   `datos/facturacion.xlsx`.
8. Confirmar a Fernando qué clientes se actualizaron y el resumen económico
   guardado.

## Consultar el registro económico

- `python -m economia.cli semana 2026-07-13` — resumen de la semana que
  empieza ese lunes.
- `python -m economia.cli mes 2026 7` — resumen agregado de ese mes.
- `python -m economia.cli kids 2026 7 450` — Fernando indica que CrossFit
  Kids facturó 450€ en julio 2026; reparte el precio por sesión hacia atrás
  sobre todas las semanas de ese mes ya registradas y actualiza el resumen
  mensual. Pedir siempre confirmación antes de ejecutar esto (es una
  escritura).

## Reglas

- Nunca ejecutar el modo `aplicar` (ni el comando `kids`) sin confirmación
  explícita previa.
- Nunca reconstruir de memoria la lista de eventos — debe ir del conector
  al script sin transcripción manual (lección del 2026-07-14).
- Tras `aplicar`, recordar a Fernando que si necesita reabrir el Excel de
  clientes para revisar algo, y el sistema vuelve a tocarlo más adelante,
  las fórmulas de tarifa/sesiones necesitarán un Ctrl+S en Excel de verdad
  para recalcularse (lección del 2026-07-15).
