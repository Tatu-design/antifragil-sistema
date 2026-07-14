# ARQUITECTURA.md — Estado técnico actual

> Este documento refleja el estado real del proyecto, no el plan. Se actualiza
> cada vez que cambia algo técnico relevante.

## Estado actual

En construcción: paso 1 del [orden de build de la V1](#orden-de-construcción-de-la-v1-decidido-2026-07-14)
— lectura de Google Calendar y resumen en pantalla, sin escritura todavía.

## Stack técnico (decidido 2026-07-14)

| Pieza | Elección | Por qué |
|---|---|---|
| Lenguaje | Python | Legible, librerías maduras para Calendar/Notion/Sheets, fácil de depurar en pareja con IA |
| Interfaz | Streamlit | Convierte un script en una página web local simple (botón + tabla), sin escribir HTML/CSS |
| Base de datos interna | SQLite | Un único archivo local, cero instalación/configuración de servidor |
| Hosting | Local (el ordenador de Fernando) | Sin coste ni complejidad de despliegue; los datos de clientes no salen de la máquina |

## Estructura de carpetas

```
antifragil/
  calendar_integration/   # lectura y parseo de Google Calendar (independiente)
  db/                      # base de datos interna SQLite (independiente)
  ui/                      # interfaz Streamlit (independiente)
  requirements.txt
  app.py                   # punto de entrada
```

Cada carpeta es un módulo independiente: Calendar, Notion (futuro), Sheets (futuro),
base de datos e interfaz no comparten código entre sí, solo se comunican a través
de funciones bien definidas.

## Orden de construcción de la V1 (decidido 2026-07-14)

Fernando confirmó que la V1 se construye en pasos pequeños y verificables, no de
una vez. Orden acordado:

1. Leer Google Calendar y mostrar en pantalla las sesiones detectadas por cliente
   (PT, CrossFit Lidomare, CrossFit Kids). Sin escritura en ningún sitio todavía.
2. Añadir la lógica de programas: descuento de sesiones, aviso de "queda una
   sesión", renovación automática al llegar a cero.
3. Conectar Notion (con confirmación previa de Fernando antes de escribir).
4. Conectar Google Sheets (resumen económico semanal/mensual).

Cada paso debe verse funcionando antes de empezar el siguiente.

## Próximos pasos técnicos pendientes de decidir

- Stack tecnológico (lenguaje, framework, hosting) — necesario para arrancar el
  paso 1 (lectura de Calendar)
- Cómo se autentica la app contra Google Calendar (y más adelante Notion y
  Google Sheets)
- Diseño de la base de datos interna (clientes, programas, sesiones, pagos)
- Diseño del módulo de detección de sesiones desde Google Calendar
  (parseo de "PT + Nombre", "CrossFit Lidomare", "CrossFit Kids")

## Principios de arquitectura (de SYSTEM_VISION.md)

- Módulos independientes: Google Calendar, Notion, Google Sheets, base de datos
  interna e interfaz no deben mezclarse en una sola pieza de código.
- Ninguna escritura en Notion o Google Sheets sin confirmación previa del usuario.
- Diseñada para escalar a futuros módulos (fisioterapia, nutrición, psicología,
  finanzas, etc.) sin rehacer la base.
