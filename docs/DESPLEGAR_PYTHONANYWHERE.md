# Cómo alojar la web app en PythonAnywhere

> ⚠️ **DOCUMENTO HISTÓRICO.** Describe la aplicación **Flask en
> PythonAnywhere**, que fue la del proyecto hasta el 2026-08-05 y **ya no lo
> es**. La aplicación actual es la de **Next.js + Supabase en Vercel**
> (`apps/control-entrenamiento-next`). Se conserva porque explica de dónde
> viene el sistema, no cómo funciona hoy.


Esto se hace **una sola vez**. Son pasos en una cuenta nueva (tuya) en
pythonanywhere.com — necesitan tu usuario, así que no puedo hacerlos yo por
ti, igual que pasó con Google Calendar. Te dejo el proceso completo; si te
atascas en cualquier paso, dime exactamente qué ves y seguimos juntos.

**Importante:** nuestro código usa una forma de escribir Python algo
moderna (por ejemplo `dict[str, int]`), que necesita **Python 3.10 o más
nuevo**. Cuando el proceso te pida elegir una versión de Python, elige
siempre la más alta disponible.

## 1. Crear la cuenta

1. Entra en https://www.pythonanywhere.com/ y crea una cuenta gratuita
   ("Beginner account").
2. Confirma tu email si te lo pide.

## 2. Subir el proyecto

El proyecto vive solo en tu ordenador todavía (no está en GitHub), así que
lo subimos como un archivo comprimido:

1. En tu ordenador, comprime la carpeta entera del proyecto
   (`Entrenamiento Personal - Antifragil`) en un `.zip`. Botón derecho
   sobre la carpeta → "Enviar a" → "Carpeta comprimida (en zip)" (Windows).
2. En PythonAnywhere, ve a la pestaña **"Files"**.
3. Crea una carpeta nueva, por ejemplo `antifragil`.
4. Entra en esa carpeta y usa el botón de subir archivo ("Upload a file")
   para subir el `.zip` que acabas de crear.
5. Ve a la pestaña **"Consoles"** → abre una consola **"Bash"**.
6. En esa consola, escribe (ajusta el nombre del zip si es distinto):
   ```
   cd antifragil
   unzip "Entrenamiento Personal - Antifragil.zip"
   ```
   Esto descomprime todo el proyecto dentro de esa carpeta.

## 3. Crear el entorno de Python

En la misma consola Bash:

```
mkvirtualenv --python=/usr/bin/python3.10 antifragil-env
pip install -r requirements.txt
```

(Si PythonAnywhere ofrece una versión de Python más alta que 3.10, por
ejemplo 3.11 o 3.12, usa esa en el `--python=...`.)

## 4. Crear la web app

1. Ve a la pestaña **"Web"** → **"Add a new web app"**.
2. Elige tu dominio gratuito (algo como `tuusuario.pythonanywhere.com`).
3. Cuando pregunte el framework, elige **"Manual configuration"** (no el
   asistente automático de Flask) y la misma versión de Python que usaste
   en el paso 3.

## 5. Conectar la web app con el código

En la página de configuración de tu web app (pestaña "Web"):

1. **Virtualenv**: pon la ruta al entorno que creaste, algo como
   `/home/TUUSUARIO/.virtualenvs/antifragil-env` (sustituye `TUUSUARIO`
   por tu nombre de usuario de PythonAnywhere).
2. **Código fuente / Working directory**: la ruta a la carpeta del
   proyecto, por ejemplo `/home/TUUSUARIO/antifragil/Entrenamiento Personal - Antifragil`.
3. **Archivo de configuración WSGI**: haz clic en el enlace que aparece
   (algo como `/var/www/tuusuario_pythonanywhere_com_wsgi.py`) para
   editarlo. Borra todo su contenido y pon esto (cambiando `TUUSUARIO` y
   la ruta por las tuyas):

   ```python
   import sys

   ruta_proyecto = "/home/TUUSUARIO/antifragil/Entrenamiento Personal - Antifragil"
   if ruta_proyecto not in sys.path:
       sys.path.insert(0, ruta_proyecto)

   from webapp.app import app as application
   ```

4. Guarda el archivo.
5. Vuelve a la pestaña "Web" y pulsa el botón verde grande **"Reload"**.

## 6. Probarlo

Abre `https://TUUSUARIO.pythonanywhere.com/` — debería pedirte crear tu
contraseña (o iniciar sesión, si ya la configuraste en tu ordenador y subes
esa misma base de datos).

## Sobre los datos reales

`datos/antifragil.db` (tus clientes y facturación reales) **no se sube por
el zip** — está excluido a propósito para que nunca viaje por ningún sitio
sin que tú decidas cuándo. Cuando quieras que la web de PythonAnywhere
tenga tus datos reales, sube ese archivo aparte a la carpeta `datos/` desde
la pestaña "Files", igual que hiciste con el zip.

## Si algo falla

La pestaña "Web" tiene un enlace a los **"Error logs"** — ahí aparece el
motivo exacto si la página da error al abrirla. Cópiame lo que veas ahí y
lo miramos juntos.
