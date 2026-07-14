"""Lectura de eventos de Google Calendar para una semana concreta.

Google Calendar ya excluye por defecto los eventos eliminados (no hace falta
filtrarlos a mano) — así se cumple la regla de SYSTEM_VISION.md de que las
sesiones eliminadas no se contabilizan.
"""

from datetime import datetime, time, timedelta


def get_week_range(any_day_in_week: datetime) -> tuple[datetime, datetime]:
    """Dado cualquier día, devuelve el lunes 00:00 y el domingo 23:59 de esa semana."""
    monday = any_day_in_week - timedelta(days=any_day_in_week.weekday())
    start = datetime.combine(monday.date(), time.min)
    end = datetime.combine((monday + timedelta(days=6)).date(), time.max)
    return start, end


def get_events_for_week(service, any_day_in_week: datetime, calendar_id: str = "primary") -> list[dict]:
    """Devuelve los eventos de la semana (lunes-domingo) que contiene any_day_in_week."""
    start, end = get_week_range(any_day_in_week)

    result = (
        service.events()
        .list(
            calendarId=calendar_id,
            timeMin=start.isoformat() + "Z",
            timeMax=end.isoformat() + "Z",
            singleEvents=True,
            orderBy="startTime",
        )
        .execute()
    )
    return result.get("items", [])
