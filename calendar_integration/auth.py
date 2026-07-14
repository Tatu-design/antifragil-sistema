"""Autenticación contra Google Calendar.

Requiere un archivo `credentials.json` (descargado desde Google Cloud Console,
ver docs/CONFIGURAR_GOOGLE_CALENDAR.md) en la raíz del proyecto. La primera vez
que se ejecuta, abre el navegador para que Fernando autorice el acceso; a partir
de ahí queda guardado en `token.json` y no se vuelve a pedir.
"""

from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]

ROOT_DIR = Path(__file__).resolve().parent.parent
CREDENTIALS_PATH = ROOT_DIR / "credentials.json"
TOKEN_PATH = ROOT_DIR / "token.json"


def get_calendar_service():
    """Devuelve un cliente autenticado de Google Calendar (solo lectura)."""
    if not CREDENTIALS_PATH.exists():
        raise FileNotFoundError(
            "Falta el archivo credentials.json en la raíz del proyecto. "
            "Sigue docs/CONFIGURAR_GOOGLE_CALENDAR.md para obtenerlo."
        )

    creds = None
    if TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                str(CREDENTIALS_PATH), SCOPES
            )
            creds = flow.run_local_server(port=0)
        TOKEN_PATH.write_text(creds.to_json())

    return build("calendar", "v3", credentials=creds)
