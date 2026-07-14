# Cómo conectar la app a tu Google Calendar

Esto se hace **una sola vez**. Son 4 pasos dentro de tu cuenta de Google.
Necesitan tu login porque solo tú puedes autorizar el acceso a tu propio
calendario — nadie más puede hacerlo por ti, ni siquiera Claude.

**Idea general:** vamos a crear una "cuenta de servicio", que es como un
empleado robot sin persona detrás. Luego compartes tu calendario con ese
"empleado", igual que compartirías un documento de Google con un compañero.
Así la app puede leerlo sin que tú tengas que iniciar sesión cada semana.

## 1. Crear un proyecto en Google Cloud

1. Entra en https://console.cloud.google.com/ con tu cuenta de Google.
2. Arriba a la izquierda, clic en el selector de proyectos → "Proyecto nuevo".
3. Nómbralo, por ejemplo `antifragil-app`, y créalo.

## 2. Activar la API de Google Calendar

1. Con el proyecto seleccionado, ve a "APIs y servicios" → "Biblioteca".
2. Busca "Google Calendar API" → clic en "Habilitar".

## 3. Crear la cuenta de servicio y descargar su llave

1. Ve a "APIs y servicios" → "Credenciales" → "Crear credenciales" →
   "Cuenta de servicio".
2. Ponle un nombre, por ejemplo `lector-calendario`, y clic en "Listo"
   (no hace falta asignarle ningún permiso adicional).
3. En la lista de cuentas de servicio, haz clic en la que acabas de crear.
4. Copia su email — algo como `lector-calendario@antifragil-app.iam.gserviceaccount.com`.
   Lo necesitarás en el paso 4.
5. Ve a la pestaña "Claves" → "Agregar clave" → "Crear clave nueva" → tipo
   "JSON" → "Crear". Se descargará un archivo automáticamente.
6. Renombra ese archivo a `credentials.json` y colócalo en la carpeta raíz
   del proyecto (la misma carpeta donde está `app.py`).

**Importante:** ese archivo es como una contraseña. Nunca lo compartas ni lo
subas a ningún sitio — ya está protegido para que no se suba a Git.

## 4. Compartir tu calendario con la cuenta de servicio

1. Abre Google Calendar → icono de engranaje → "Configuración".
2. En el menú de la izquierda, bajo "Configuración de calendarios", elige
   tu calendario.
3. Busca "Compartir con determinadas personas o grupos" → "Añadir personas".
4. Pega el email de la cuenta de servicio (el que copiaste en el paso 3.4).
5. En el permiso, elige "Ver todos los detalles del evento".
6. En la misma pantalla, sección "Integrar calendario", copia el
   "ID de calendario" (normalmente es tu propio email). Ese ID lo pegarás
   la primera vez que abras la app, en el campo "ID de tu calendario".

## Listo

Con `credentials.json` en su sitio y el calendario compartido, la app ya
puede leer tus sesiones. No hace falta repetir estos pasos ni volver a
iniciar sesión en el futuro.
