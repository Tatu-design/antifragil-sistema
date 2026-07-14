# SYSTEM_VISION.md

# Sistema Operativo de Entrenamiento Personal — Antifrágil

## Visión del proyecto

Este proyecto tiene como objetivo construir el sistema operativo interno para la gestión del servicio de entrenamiento personal de Antifrágil.

No pretende ser una aplicación completa desde el principio.

El objetivo es desarrollar una herramienta muy sencilla, muy estable y extremadamente útil que resuelva un problema real de trabajo diario.

A partir de esa primera versión, el sistema irá evolucionando poco a poco conforme aparezcan nuevas necesidades.

La prioridad absoluta NO es tener muchas funcionalidades.

La prioridad es tener una herramienta que funcione bien y que sea fácil de mantener.

---

# Filosofía del proyecto

Este proyecto se construirá siguiendo cinco principios.

## 1. Simplicidad

Siempre se elegirá la solución más sencilla posible.

Una solución simple y estable es preferible a una solución compleja con muchas funcionalidades.

---

## 2. Evolución progresiva

No se pretende construir un ERP completo.

Se construirá una primera versión pequeña.

Cuando esa versión funcione correctamente se añadirán nuevas funcionalidades.

Cada mejora deberá apoyarse sobre una base estable.

Nunca se desarrollarán funcionalidades futuras si comprometen la simplicidad de la versión actual.

---

## 3. Arquitectura escalable

Aunque la primera versión sea pequeña, la arquitectura debe permitir crecer sin tener que rehacer el proyecto.

El sistema deberá permitir incorporar en el futuro nuevos módulos como:

- Fisioterapia
- Nutrición
- Psicología
- Readaptación
- Gestión de pacientes
- Dashboard empresarial
- Finanzas
- Integración con la App de Antifrágil

Sin modificar la estructura principal del proyecto.

---

## 4. El usuario NO es programador

El propietario del proyecto no tiene formación técnica.

Por tanto:

- la herramienta debe ser muy sencilla de utilizar
- todas las decisiones técnicas deben priorizar la facilidad de uso
- los mensajes de error deben ser comprensibles
- cualquier configuración debe ser lo más visual posible

Claude siempre debe explicar las decisiones utilizando lenguaje no técnico.

---

## 5. Seguridad

La aplicación nunca debe modificar información crítica automáticamente sin confirmación previa.

Siempre existirá un paso de revisión antes de escribir datos en Notion o Google Sheets.

---

# Objetivo de la versión 1

La primera versión únicamente debe resolver el proceso semanal de entrenamiento personal.

Nada más.

No debe incorporar funcionalidades futuras hasta que esta primera versión sea estable.

---

# Problema que resuelve

Actualmente el proceso semanal requiere revisar manualmente:

- Google Calendar
- Notion
- Google Sheets

Esto obliga a realizar múltiples tareas repetitivas.

El objetivo es automatizar ese proceso manteniendo siempre el control por parte del usuario.

---

# Flujo de trabajo esperado

El funcionamiento ideal será:

1. Abrir la aplicación.

2. Seleccionar la semana.

3. Leer Google Calendar.

4. Detectar automáticamente todas las sesiones válidas.

5. Identificar el cliente correspondiente.

6. Calcular producción semanal.

7. Actualizar los programas de entrenamiento.

8. Detectar renovaciones.

9. Detectar pagos pendientes.

10. Mostrar un resumen.

11. Esperar confirmación del usuario.

12. Actualizar Notion.

13. Actualizar Google Sheets.

---

# Funcionalidades de la versión 1

La primera versión debe ser capaz de:

## Google Calendar

Leer automáticamente:

- PT + Nombre
- CrossFit Lidomare
- CrossFit Kids

Todas las sesiones duran 60 minutos.

Las sesiones eliminadas del calendario no se contabilizan.

Las sesiones existentes sí se contabilizan.

---

## Entrenamiento Personal

Cada cliente tendrá un programa activo.

El sistema debe:

- descontar sesiones
- detectar cuando queda una sesión
- renovar automáticamente el programa cuando llegue a cero
- mantener tarifa y número de sesiones
- marcar automáticamente el nuevo programa como pendiente de pago

Si posteriormente el usuario cambia manualmente la tarifa o el tipo de programa, el sistema deberá respetarlo.

---

## Parejas

Las parejas funcionan como una única unidad.

Comparten:

- programa
- consumo
- pago
- renovación

Nunca deben duplicarse sesiones.

---

## CrossFit Lidomare

Únicamente se contabilizará el número de clases realizadas durante el mes.

No existen programas.

---

## CrossFit Kids

Únicamente se contabilizará el número de clases realizadas.

Al finalizar el mes el usuario introducirá manualmente la facturación mensual.

La aplicación calculará automáticamente el valor económico por sesión.

---

## Notion

Existirá una única base de datos sencilla para gestionar los clientes.

El usuario podrá:

- crear clientes
- modificar tarifas
- cambiar programas
- confirmar pagos
- pausar clientes
- cancelar clientes

Todo ello manualmente.

La automatización únicamente actualizará la información necesaria.

---

## Google Sheets

La aplicación generará automáticamente el resumen económico semanal y mensual.

El usuario podrá modificar posteriormente cualquier dato manualmente si fuera necesario.

---

# Qué NO debe hacer la versión 1

No debe gestionar:

- fisioterapia
- nutrición
- psicología
- facturación legal
- CRM
- WhatsApp
- emailing
- pagos online
- app móvil
- múltiples centros

Todo eso pertenece a futuras versiones.

---

# Arquitectura

La aplicación debe construirse de forma modular.

Cada integración debe ser independiente.

Ejemplo:

- Google Calendar
- Notion
- Google Sheets
- Base de datos interna
- Interfaz

Nunca debe existir una única pieza de código que haga todo.

---

# Interfaz

La interfaz debe ser extremadamente sencilla.

Minimalista.

Pensada para utilizarse una vez por semana.

El usuario debe poder aprender a utilizarla en menos de cinco minutos.

---

# Regla principal del proyecto

Siempre será preferible una herramienta pequeña, estable y fácil de entender antes que una herramienta grande difícil de mantener.

Toda nueva funcionalidad deberá justificar claramente qué problema real resuelve.

Si una mejora aumenta mucho la complejidad y aporta poco valor, deberá descartarse.

---

# Objetivo final

Este proyecto constituye el primer módulo del futuro Sistema Operativo de Antifrágil.

La prioridad no es construir un gran software.

La prioridad es construir una base sólida sobre la que crecer durante los próximos años.
