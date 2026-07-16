# Proyecto de aprendizaje: web app con Flask

> Este es un proyecto aparte del sistema operativo de Antifrágil (que sigue
> funcionando por chat + Excel + dashboard). El objetivo aquí es que
> Fernando aprenda a construir una web app real, paso a paso, sin arriesgar
> los datos reales del negocio mientras se aprende.

## Por qué existe esto

Fernando quiere aprender a construir herramientas que en el futuro puedan
usar también sus clientes (cada uno viendo su propio perfil). Es un
objetivo de aprendizaje, no una necesidad urgente del negocio — por eso va
en su propia rama (`feat/webapp-flask`) y con su propio ritmo.

## Milestones (de menos a más complejidad)

1. **✅ Hecho (2026-07-16):** web app local de solo lectura. Muestra los
   clientes de `datos/clientes.xlsx` en una página web sencilla, corriendo
   en el propio ordenador de Fernando.
2. Añadir edición: formularios para cambiar sesiones/pagos desde la web
   (aprender inputs, formularios, y cómo guardar datos con seguridad).
3. Poner la web accesible desde internet (aprender qué es "alojar" una app,
   con sus costes y responsabilidades).
4. Cuentas de acceso por cliente (aprender autenticación — cada cliente ve
   solo lo suyo).

Cada paso se construye y se entiende antes de pasar al siguiente.

## Cómo funciona el paso 1

- `webapp/app.py`: la aplicación Flask. Define una "ruta" (`/`, la página
  principal) que lee `datos/clientes.xlsx` con el mismo código que ya usa
  el resto del proyecto (`clientes/repositorio.py`) y se lo pasa a una
  plantilla.
- `webapp/templates/index.html`: la plantilla — HTML normal con huecos
  (`{{ cliente.nombre }}`, etc.) que Flask rellena con los datos reales de
  cada cliente.
- `webapp/static/style.css`: los estilos visuales.

### Cómo arrancarla

Desde la raíz del proyecto:

```
.venv/Scripts/python.exe -m webapp.app
```

(se ejecuta como módulo, `-m webapp.app`, y no directamente el archivo,
para que Python encuentre el resto del código del proyecto como
`clientes/repositorio.py`).

Luego abre `http://127.0.0.1:5000/` en el navegador de tu propio ordenador.
De momento **no es accesible desde el móvil** — corre solo en tu máquina
(eso es precisamente el milestone 3).

## Reglas de este proyecto

- No toca el flujo real del negocio (Calendar, cierre semanal, dashboard) —
  es de solo lectura sobre los mismos archivos.
- Cuando se llegue al paso de escritura (milestone 2), aplican las mismas
  reglas de seguridad que el resto del proyecto: nunca guardar cambios sin
  una confirmación clara del usuario.
