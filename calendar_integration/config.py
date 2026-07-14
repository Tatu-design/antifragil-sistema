"""Guarda localmente el ID del calendario de Fernando para no tener que
volver a escribirlo cada vez que abre la app."""

import json
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parent.parent / "calendar_config.json"


def cargar_calendar_id() -> str:
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text()).get("calendar_id", "")
    return ""


def guardar_calendar_id(calendar_id: str) -> None:
    CONFIG_PATH.write_text(json.dumps({"calendar_id": calendar_id}))
