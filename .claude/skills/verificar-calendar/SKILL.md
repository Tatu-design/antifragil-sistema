---
name: verificar-calendar
description: Comprobación semanal de solo lectura — compara lo que Fernando ha firmado en la app con lo que realmente hay en Calendar esa semana, y deja como aviso cualquier diferencia. Nunca escribe en clientes ni en economía.
---

# Skill: Verificar semana contra Calendar

Desde el 2026-07-22, las sesiones se cuentan **firmando en la app**, no
leyendo Calendar (ver `docs/ARQUITECTURA.md`). Este skill usa Calendar solo
como comprobación al final de la semana: ¿coincide lo firmado con lo que
de verdad pasó? Es de solo lectura sobre clientes/economía — la única
escritura son avisos (`avisos.py`), y nunca corrige nada por su cuenta.

## Pasos

1. Calcular el lunes y el domingo de la semana a comprobar (normalmente la
   semana actual o la que acaba de terminar).
2. Llamar a `mcp__claude_ai_Google_Calendar__list_events` con el rango
   lunes–domingo en `Europe/Madrid` (igual que en `resumen-semanal`).
   Guardar el array `events` tal cual, nunca retipeado a mano.
3. Hacer un POST con el token de administración a la ruta del servidor:
   ```
   POST https://tatu17.pythonanywhere.com/admin/verificar-semana
   Header: X-Admin-Token: <el token de datos/config_servidor.json>
   Body: {"eventos": [...], "fecha_referencia": "YYYY-MM-DD"}
   ```
   (usa `requests` desde Python, o `curl --data @archivo.json` si el
   array es grande — igual que en `admin/procesar-dia`).
4. El servidor compara y devuelve `{"semana": "...", "discrepancias": [...]}`.
   Cada discrepancia ya ha quedado guardada como aviso — no hace falta
   guardar nada más.
5. Contarle a Fernando un resumen corto: cuántas discrepancias, y cuáles
   (o "todo cuadra" si la lista está vacía). Los avisos ya están en la web
   para que los revise cuando quiera, con el contador de "nuevo" en el menú.

## Qué compara

- Por cliente: fechas de sesión en Calendar vs. fechas firmadas en su
  historial esa semana — en los dos sentidos (falta firmar / firmada sin
  evento en Calendar).
- Clientes que aparecen en Calendar pero no existen en la app.
- Eventos de Calendar sin clasificar (no encajan con "Pt Nombre",
  "CrossFit Lidomare" ni "CrossFit Kids").
- Número de clases de CrossFit Lidomare y Kids: Calendar vs. lo registrado
  en la app esa semana.

## Reglas

- Nunca escribir en `clientes`, `historial_sesiones` ni `semanas` desde
  este flujo — solo avisos. Si algo hay que corregir de verdad, se hace a
  mano (Editar cliente, o firmando/borrando la sesión que falte) tras
  hablarlo con Fernando.
- Nunca reconstruir de memoria la lista de eventos de Calendar (misma
  regla que el resto del proyecto).
