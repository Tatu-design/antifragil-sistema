"""Sincroniza la base de datos real con el servidor de PythonAnywhere, para
que la web pública refleje siempre el último cierre semanal sin que
Fernando tenga que subir nada a mano.

Usa la API propia de PythonAnywhere (subir archivo + recargar la web) —
no hace falta ninguna credencial de Google ni nada más complicado.

Requiere un archivo de configuración local, `datos/config_servidor.json`
(fuera de git, nunca se sube), con este formato:

    {
      "usuario": "tu_usuario_de_pythonanywhere",
      "token_api": "tu_token_api",
      "dominio": "tuusuario.pythonanywhere.com"
    }

Si ese archivo no existe, `sincronizar()` no hace nada — cerrar la semana
en local sigue funcionando igual sin esto configurado (la sincronización
con el servidor es un extra, no un requisito).
"""

import json
from pathlib import Path

import requests

from basedatos import RUTA_POR_DEFECTO

RUTA_CONFIG = Path(__file__).resolve().parent / "datos" / "config_servidor.json"


def _cargar_config() -> dict | None:
    if not RUTA_CONFIG.exists():
        return None
    return json.loads(RUTA_CONFIG.read_text(encoding="utf-8"))


def subir_archivo(ruta_local: Path, ruta_relativa_proyecto: str) -> str:
    """Sube un archivo cualquiera del proyecto (plantilla, CSS, código...) a
    la misma ruta dentro de la carpeta del proyecto en el servidor. Uso
    puntual cuando cambia código, no solo datos — ver sincronizar()."""
    config = _cargar_config()
    if config is None:
        return "Sincronización con el servidor no configurada."

    usuario = config["usuario"]
    token = config["token_api"]
    base_api = f"https://www.pythonanywhere.com/api/v0/user/{usuario}"
    headers = {"Authorization": f"Token {token}"}

    try:
        with open(ruta_local, "rb") as archivo:
            respuesta = requests.post(
                f"{base_api}/files/path/home/{usuario}/Antifragil/{ruta_relativa_proyecto}",
                headers=headers,
                files={"content": archivo},
                timeout=30,
            )
        if respuesta.status_code not in (200, 201):
            return f"Fallo al subir {ruta_relativa_proyecto} (código {respuesta.status_code})."
    except requests.RequestException as error:
        return f"No se pudo contactar con el servidor subiendo {ruta_relativa_proyecto}: {error}"

    return f"OK: {ruta_relativa_proyecto}"


def recargar_web() -> str:
    config = _cargar_config()
    if config is None:
        return "Sincronización con el servidor no configurada."

    usuario = config["usuario"]
    token = config["token_api"]
    dominio = config["dominio"]
    headers = {"Authorization": f"Token {token}"}

    try:
        respuesta = requests.post(
            f"https://www.pythonanywhere.com/api/v0/user/{usuario}/webapps/{dominio}/reload/",
            headers=headers,
            timeout=30,
        )
    except requests.RequestException as error:
        return f"No se pudo recargar la web: {error}"

    if respuesta.status_code != 200:
        return f"No se pudo recargar la web (código {respuesta.status_code})."
    return f"Web recargada: https://{dominio}/"


def sincronizar(ruta_db: Path = RUTA_POR_DEFECTO) -> str:
    """Sube la base de datos actual al servidor y recarga la web. Devuelve
    un mensaje legible sobre el resultado — nunca lanza una excepción, para
    que un fallo de red no eche por tierra un cierre semanal que ya se
    guardó correctamente en local."""
    config = _cargar_config()
    if config is None:
        return "Sincronización con el servidor no configurada (el cierre ya se guardó en local)."

    usuario = config["usuario"]
    token = config["token_api"]
    dominio = config["dominio"]
    base_api = f"https://www.pythonanywhere.com/api/v0/user/{usuario}"
    headers = {"Authorization": f"Token {token}"}

    try:
        with open(ruta_db, "rb") as archivo:
            respuesta = requests.post(
                f"{base_api}/files/path/home/{usuario}/Antifragil/datos/antifragil.db",
                headers=headers,
                files={"content": archivo},
                timeout=30,
            )
        if respuesta.status_code not in (200, 201):
            return f"No se pudo subir la base de datos al servidor (código {respuesta.status_code})."

        respuesta_reload = requests.post(
            f"{base_api}/webapps/{dominio}/reload/",
            headers=headers,
            timeout=30,
        )
        if respuesta_reload.status_code != 200:
            return f"Base de datos subida, pero no se pudo recargar la web (código {respuesta_reload.status_code})."
    except requests.RequestException as error:
        return f"No se pudo contactar con el servidor: {error}"

    return f"Servidor actualizado y recargado: https://{dominio}/"
