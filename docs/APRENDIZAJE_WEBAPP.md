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
2. **✅ Hecho (2026-07-16/17):** crear clientes nuevos y editar nombre, tipo
   de programa, sesiones completadas y pendiente de pago, todo desde la web
   (Fernando ya no necesita abrir el Excel para el día a día). Pantalla de
   confirmación "antes → después" antes de guardar — nunca se escribe
   directamente desde el formulario. Se añadió también una pestaña
   "Economía" (`/economia`) con la facturación semanal y mensual en
   directo desde `datos/facturacion.xlsx` — antes esto solo estaba en el
   dashboard publicado (Artifact), que quedaba desconectado de esta web.
3. Poner la web accesible desde internet (aprender qué es "alojar" una app,
   con sus costes y responsabilidades). **Decisión tomada (2026-07-17):**
   antes de alojarla, migrar de Excel a una base de datos real (SQLite para
   empezar) — la mayoría de alojamientos no garantizan que un archivo como
   `datos/clientes.xlsx` sobreviva a un reinicio, y es además una lección
   de aprendizaje real en sí misma. Próximos pasos pendientes:
   - Diseñar el esquema (tabla de clientes con las mismas columnas de hoy).
   - Nuevo módulo de acceso a datos con `sqlite3` (sustituye a
     `clientes/repositorio.py`, que sigue existiendo para el sistema real
     del negocio con Excel — no se toca).
   - Migrar los datos actuales del Excel a la base de datos.
   - Adaptar `webapp/app.py` para leer/escribir de la base de datos.
   - Solo entonces: elegir dónde alojarla.
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

### Arranque automático (2026-07-16)

Fernando pidió no depender de pedirle a Claude que la encienda cada vez.
Se configuró para que arranque sola al iniciar sesión en Windows, sin
ninguna ventana visible:

- Archivo: `C:\Users\usuario\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\antifragil_webapp.vbs`
  (fuera del repositorio de código a propósito — es configuración de este
  ordenador concreto, no del proyecto).
- Ejecuta `pythonw.exe -m webapp.app` (la variante de Python sin consola)
  con el directorio de trabajo puesto en la carpeta del proyecto.
- **Por qué la carpeta de Inicio y no el Programador de tareas de
  Windows:** se intentó primero con `Register-ScheduledTask`/`schtasks`,
  pero el entorno donde Claude ejecuta comandos no tiene permiso para crear
  tareas programadas ("Acceso denegado"). Colocar un script en la carpeta
  de Inicio logra el mismo resultado (arrancar algo al iniciar sesión) sin
  necesitar esos permisos.
- Por el mismo motivo se cambió `app.run(debug=True)` a `debug=False` en
  `webapp/app.py`: el modo de depuración de Flask no es seguro para algo
  que va a quedar corriendo de forma permanente.

Para desactivar el arranque automático: borrar ese archivo `.vbs` de la
carpeta de Inicio.

## Cómo funciona el paso 2 (crear y editar)

Mismo flujo en tres pantallas para ambos casos, para nunca guardar sin querer:

- **Crear**: `/cliente/nuevo` (formulario vacío) → `/cliente/nuevo/confirmar`
  (revisar, nada guardado aún) → `/cliente/nuevo/guardar` (llama a
  `clientes.repositorio.crear_cliente()`).
- **Editar**: `/cliente/<nombre>/editar` (formulario con los valores
  actuales: nombre, tipo de programa, sesiones completadas, pendiente de
  pago) → `/cliente/<nombre>/confirmar` (antes → después) →
  `/cliente/<nombre>/guardar` (llama a `clientes.repositorio.actualizar_cliente()`).

El nombre del cliente también se puede cambiar desde el editor — la web
avisa de que hay que renombrar igual las sesiones en Google Calendar, o el
sistema dejaría de reconocerlas (el nombre es la clave que cruza Calendar
con el Excel).

**Errores manejados con mensajes claros** (antes daban un error genérico
de servidor):
- Excel abierto al intentar guardar (`PermissionError`) → aviso pidiendo
  cerrarlo.
- Nombre repetido o vacío al crear/renombrar (`ValueError`) → aviso
  explicando el motivo.

Al probarlo se descubrió que guardar desde la web (con `openpyxl`) borra el
valor calculado de tarifa/sesiones de **todos** los clientes, no solo del
editado — es una limitación conocida de esa librería. Se arregló en
`clientes/repositorio.py`: si el valor calculado no está disponible, se
recalcula en Python contra la hoja "Programas", así que no hace falta
reabrir el Excel para que el sistema siga funcionando bien (ver log de
lecciones aprendidas, 2026-07-16).

**Terminología (2026-07-16):** "sesiones llevadas" pasó a llamarse
**"sesiones completadas"** en todo el proyecto (código, Excel, web) a
petición de Fernando.

## Reglas de este proyecto

- No toca el flujo real del negocio (Calendar, cierre semanal, dashboard) —
  comparte solo la lectura/escritura de `datos/clientes.xlsx` a través del
  mismo `clientes/repositorio.py`.
- Ninguna escritura sin pantalla de confirmación previa — misma regla de
  seguridad que el resto del proyecto.
