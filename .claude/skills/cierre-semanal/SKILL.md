---
name: cierre-semanal
description: Flujo semanal completo — lee Calendar, calcula sesiones/renovaciones/pagos con la base de datos de clientes, muestra un resumen y solo escribe en el Excel si Fernando confirma explícitamente.
---

# Skill: Cierre semanal

Implementa el paso 3 de la V1 (`docs/ARQUITECTURA.md`): unir la lectura de
Calendar con la lógica de programas, y actualizar `datos/clientes.xlsx`
**solo con confirmación explícita de Fernando**. Nunca escribir sin ese
paso — es una regla de seguridad no negociable del proyecto.

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
   .venv/Scripts/python.exe -m cierre_semanal.cli previsualizar < eventos_semana.json
   ```
   Esto NO escribe nada — solo calcula, usando los datos actuales de
   `datos/clientes.xlsx`.
5. Presentar el resultado a Fernando en una tabla clara:
   - Por cliente: sesiones consumidas esta semana, sesiones llevadas
     nuevas, si se renueva el bono, si queda pendiente de pago, aviso de
     "última sesión".
   - CrossFit Lidomare / CrossFit Kids: nº de clases (informativo, no
     descuenta programa).
   - `sin_programa`: nombres detectados en Calendar que no coinciden con
     ninguna fila del Excel — pedir revisión (puede ser un alias distinto,
     un cliente nuevo sin dar de alta, o un error de escritura).
   - `incompletos_datos`: clientes del Excel a los que les falta tipo de
     programa o sesiones llevadas.
6. **Esperar la confirmación explícita de Fernando** antes de continuar.
   Si hay `sin_programa` o `incompletos_datos`, dejarlo claro y no asumir
   nada por él.
7. Solo si confirma, ejecutar:
   ```
   .venv/Scripts/python.exe -m cierre_semanal.cli aplicar < eventos_semana.json
   ```
   (mismo archivo de eventos que en el paso 4, para garantizar que se
   escribe exactamente lo que se previsualizó).
8. Confirmar a Fernando qué clientes se actualizaron.

## Reglas

- Nunca ejecutar el modo `aplicar` sin confirmación explícita previa.
- Nunca reconstruir de memoria la lista de eventos — debe ir del conector
  al script sin transcripción manual (lección del 2026-07-14).
- Tras `aplicar`, recordar a Fernando que si necesita reabrir el Excel para
  revisar algo, y el sistema vuelve a tocarlo más adelante, las fórmulas de
  tarifa/sesiones necesitarán un Ctrl+S en Excel de verdad para
  recalcularse (lección del 2026-07-15).
