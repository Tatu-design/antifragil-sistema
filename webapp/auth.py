"""Autenticación de un único usuario (Fernando) para la web app.

Antes de que esta web sea visible desde internet (milestone 3 de
docs/APRENDIZAJE_WEBAPP.md), hace falta al menos una contraseña — si no,
cualquiera con el enlace podría ver y editar los datos de tus clientes.
Esto es distinto del milestone 4 (una cuenta por cliente): aquí solo hay
un usuario, tú.

La contraseña se guarda como "hash" (una huella irreversible, no el texto
plano) usando las herramientas de seguridad que ya trae Flask
(`werkzeug.security`) — así, aunque alguien viera la base de datos, no
podría recuperar tu contraseña real a partir de lo guardado.
"""

import secrets
from pathlib import Path

from werkzeug.security import check_password_hash, generate_password_hash

from basedatos import RUTA_POR_DEFECTO, conectar


def _leer_configuracion(clave: str, ruta: Path = RUTA_POR_DEFECTO) -> str | None:
    with conectar(ruta) as conexion:
        fila = conexion.execute("SELECT valor FROM configuracion WHERE clave = ?", (clave,)).fetchone()
    return fila["valor"] if fila else None


def _guardar_configuracion(clave: str, valor: str, ruta: Path = RUTA_POR_DEFECTO) -> None:
    with conectar(ruta) as conexion:
        conexion.execute(
            "INSERT INTO configuracion (clave, valor) VALUES (?, ?) "
            "ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor",
            (clave, valor),
        )


_password_configurada_cache: bool | None = None


def hay_password_configurada(ruta: Path = RUTA_POR_DEFECTO) -> bool:
    """Se comprueba en `before_request`, es decir en TODA petición — pero la
    contraseña solo se establece una vez en la vida de la app, así que en
    cuanto se confirma que existe se guarda en memoria y no hace falta
    volver a preguntarle a la base de datos (decisión de Fernando del
    2026-07-24, tras notar la web lenta)."""
    global _password_configurada_cache
    if _password_configurada_cache:
        return True
    _password_configurada_cache = _leer_configuracion("password_hash", ruta) is not None
    return _password_configurada_cache


def establecer_password(password: str, ruta: Path = RUTA_POR_DEFECTO) -> None:
    if len(password) < 8:
        raise ValueError("La contraseña debe tener al menos 8 caracteres")
    _guardar_configuracion("password_hash", generate_password_hash(password), ruta)


def verificar_password(password: str, ruta: Path = RUTA_POR_DEFECTO) -> bool:
    hash_guardado = _leer_configuracion("password_hash", ruta)
    if not hash_guardado:
        return False
    return check_password_hash(hash_guardado, password)


def obtener_secret_key(ruta: Path = RUTA_POR_DEFECTO) -> str:
    """La clave con la que Flask firma las cookies de sesión. Se genera una
    vez y se reutiliza — si cambiara en cada arranque, todo el mundo
    tendría que volver a iniciar sesión cada vez que se reinicie la app."""
    existente = _leer_configuracion("secret_key", ruta)
    if existente:
        return existente
    nueva = secrets.token_hex(32)
    _guardar_configuracion("secret_key", nueva, ruta)
    return nueva


def obtener_admin_token(ruta: Path = RUTA_POR_DEFECTO) -> str:
    """Clave para que la actualización diaria automática (una rutina en la
    nube, sin sesión de navegador) pueda llamar a `/admin/procesar-dia` sin
    tu contraseña personal — un token de máquina a máquina, no de usuario."""
    existente = _leer_configuracion("admin_token", ruta)
    if existente:
        return existente
    nuevo = secrets.token_hex(32)
    _guardar_configuracion("admin_token", nuevo, ruta)
    return nuevo
