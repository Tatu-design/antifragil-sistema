---
name: resumen-semanal
description: Lee Google Calendar y muestra el resumen semanal de sesiones (PT, CrossFit Lidomare, CrossFit Kids). Paso 1 del sistema operativo de Antifrágil — solo lectura, no escribe en ningún sitio.
---

# Skill: Resumen semanal

Este skill implementa el Hito 0 de `SYSTEM_VISION.md`: leer las sesiones de la
semana desde Google Calendar y mostrar un resumen. No escribe en Notion ni en
Google Sheets — eso llega en pasos posteriores del proyecto.

## Cómo se usa

Fernando invoca este skill (o simplemente pide "el resumen de esta semana").
Si no especifica semana, se usa la semana actual (lunes a domingo).

## Pasos

1. Calcular el lunes y el domingo de la semana pedida.
2. Llamar a `mcp__claude_ai_Google_Calendar__list_events` con:
   - `calendarId`: `fcmarcos12@gmail.com` (el calendario real de Fernando,
     confirmado el 2026-07-14 — no los calendarios llamados "Antifrágil",
     que son otra cosa)
   - `startTime` / `endTime`: el rango lunes 00:00 – domingo 23:59, en
     `Europe/Madrid`
   - `timeZone`: `Europe/Madrid`
   - `orderBy`: `startTime`
3. Extraer el campo `summary` (título) de cada evento devuelto. Los eventos
   eliminados ya no aparecen en la respuesta del conector, así que no hace
   falta filtrarlos aparte.
4. Clasificar los títulos de forma determinista con el script del proyecto
   (no reinventar la clasificación "a ojo"): pasar la lista de títulos como
   JSON por stdin a
   `python -m calendar_integration.resumen_cli`
   ejecutado desde la raíz del proyecto. Devuelve un JSON con
   `sesiones_pt`, `crossfit_lidomare`, `crossfit_kids` y `no_reconocidos`.
5. Presentar a Fernando:
   - Tabla de sesiones de PT por cliente
   - Nº de clases de CrossFit Lidomare y CrossFit Kids
   - Los títulos en `no_reconocidos`, pidiéndole que confirme si alguno
     debería contar (para ajustar el formato de sus eventos o el clasificador)

## Reglas

- Solo lectura. Nunca escribir en Calendar, Notion o Sheets desde este skill.
- Si `python` no resuelve en el PATH de la sesión, usar la ruta completa del
  intérprete instalado (ver `docs/ARQUITECTURA.md`).
