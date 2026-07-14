# Log de lecciones aprendidas

> Cada entrada: qué pasó, por qué pasó, qué se hace distinto a partir de ahora.

## 2026-07-14 — Construí autenticación OAuth/cuenta de servicio sin comprobar si ya existía conexión

**Qué pasó:** Diseñé y construí desde cero todo el flujo de autenticación contra
Google Calendar (proyecto en Google Cloud, cuenta de servicio, `credentials.json`,
guía de configuración de varios pasos) para el Hito 0. Fernando preguntó por qué
hacía falta todo ese proceso si él ya tenía Claude conectado a su Google Calendar
mediante el conector de claude.ai. Al comprobarlo, en efecto el conector ya estaba
autorizado y podía leer sus calendarios sin ningún código adicional.

**Por qué pasó:** No comprobé qué herramientas/conectores ya estaban disponibles
en el entorno antes de diseñar la arquitectura técnica. Asumí que había que
construir la integración desde cero en vez de verificar primero qué accesos
ya existían.

**Qué se hace distinto a partir de ahora:** Antes de diseñar cualquier
integración externa (Calendar, Notion, Sheets, etc.), comprobar primero si ya
existe un conector/MCP disponible y autorizado en el entorno que resuelva el
problema sin necesidad de código ni credenciales propias. Priorizar usar lo que
ya está conectado antes de construir infraestructura nueva.
