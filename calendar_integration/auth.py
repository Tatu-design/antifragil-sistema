"""Autenticación contra Google Calendar mediante una cuenta de servicio.

Una cuenta de servicio es una credencial de Google sin una persona detrás:
no requiere iniciar sesión en un navegador ni caduca cada pocos días, a
diferencia del login normal de usuario. Requiere un archivo `credentials.json`
(la "llave" de la cuenta de servicio, ver docs/CONFIGURAR_GOOGLE_CALENDAR.md)
en la raíz del proyecto, y que Fernando comparta su calendario con el email
de esa cuenta de servicio.
"""

from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]

ROOT_DIR = Path(__file__).resolve().parent.parent
CREDENTIALS_PATH = ROOT_DIR / "credentials.json"


def get_calendar_service():
    """Devuelve un cliente autenticado de Google Calendar (solo lectura)."""
    if not CREDENTIALS_PATH.exists():
        raise FileNotFoundError(
            "Falta el archivo credentials.json en la raíz del proyecto. "
            "Sigue docs/CONFIGURAR_GOOGLE_CALENDAR.md para obtenerlo."
        )

    creds = service_account.Credentials.from_service_account_file(
        str(CREDENTIALS_PATH), scopes=SCOPES
    )
    return build("calendar", "v3", credentials=creds)
