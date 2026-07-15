"""Cálculo del rango lunes-domingo de una semana, a partir de cualquier día
de esa semana. Lógica pura, sin llamadas de red."""

from datetime import datetime, time, timedelta


def get_week_range(any_day_in_week: datetime) -> tuple[datetime, datetime]:
    """Dado cualquier día, devuelve el lunes 00:00 y el domingo 23:59 de esa semana."""
    monday = any_day_in_week - timedelta(days=any_day_in_week.weekday())
    start = datetime.combine(monday.date(), time.min)
    end = datetime.combine((monday + timedelta(days=6)).date(), time.max)
    return start, end
