# Cómo conectar la app a tu Google Calendar

Esto solo se hace **una vez**. Son pasos dentro de tu cuenta de Google — yo no
puedo hacerlos por ti porque necesitan tu usuario y contraseña.

## 1. Crear un proyecto en Google Cloud

1. Entra en https://console.cloud.google.com/ con tu cuenta de Google.
2. Arriba a la izquierda, haz clic en el selector de proyectos → "Proyecto nuevo".
3. Ponle un nombre, por ejemplo `antifragil-app`, y créalo.

## 2. Activar la API de Google Calendar

1. Con el proyecto seleccionado, ve a "APIs y servicios" → "Biblioteca".
2. Busca "Google Calendar API" y haz clic en "Habilitar".

## 3. Crear las credenciales

1. Ve a "APIs y servicios" → "Pantalla de consentimiento OAuth".
   - Tipo de usuario: "Externo".
   - Rellena solo los campos obligatorios (nombre de la app, tu email).
   - En "Usuarios de prueba", añade tu propio email.
2. Ve a "APIs y servicios" → "Credenciales" → "Crear credenciales" → "ID de cliente de OAuth".
   - Tipo de aplicación: "Aplicación de escritorio".
   - Nombre: lo que quieras, por ejemplo `antifragil-desktop`.
3. Descarga el archivo JSON generado.

## 4. Colocar el archivo en el proyecto

Renombra el archivo descargado a `credentials.json` y colócalo en la carpeta
raíz del proyecto (la misma carpeta donde está `app.py`).

**Importante:** este archivo nunca se sube a Git — ya está protegido en
`.gitignore`. Es como una contraseña: no lo compartas ni lo pegues en ningún sitio.

## 5. Primera vez que arrancas la app

La primera vez que pulses "Cargar semana", se abrirá tu navegador pidiéndote
que inicies sesión con Google y autorices el acceso (solo lectura a tu
calendario). Después de autorizar una vez, no se te volverá a pedir.
