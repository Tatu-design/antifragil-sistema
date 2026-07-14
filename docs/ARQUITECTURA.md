# ARQUITECTURA.md — Estado técnico actual

> Este documento refleja el estado real del proyecto, no el plan. Se actualiza
> cada vez que cambia algo técnico relevante.

## Estado actual

**Aún no se ha construido nada.** Este proyecto está en fase de arranque.

## Próximos pasos técnicos pendientes de decidir

- Stack tecnológico (lenguaje, framework, hosting)
- Cómo se autentica la app contra Google Calendar, Notion y Google Sheets
- Diseño de la base de datos interna (clientes, programas, sesiones, pagos)
- Diseño del módulo de detección de sesiones desde Google Calendar
  (parseo de "PT + Nombre", "CrossFit Lidomare", "CrossFit Kids")

## Principios de arquitectura (de SYSTEM_VISION.md)

- Módulos independientes: Google Calendar, Notion, Google Sheets, base de datos
  interna e interfaz no deben mezclarse en una sola pieza de código.
- Ninguna escritura en Notion o Google Sheets sin confirmación previa del usuario.
- Diseñada para escalar a futuros módulos (fisioterapia, nutrición, psicología,
  finanzas, etc.) sin rehacer la base.
