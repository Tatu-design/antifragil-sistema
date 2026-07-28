"""Fecha y hora del negocio, centralizadas en Europe/Madrid.

Antifrágil opera en España. El servidor real (PythonAnywhere) no tiene por
qué correr en la zona horaria de Madrid — usar `date.today()`/`datetime.now()`
directamente para decidir "qué día es hoy" en operaciones de negocio (firmar
una sesión, calcular la semana/mes) puede dar la fecha equivocada, sobre todo
de madrugada o en el cambio de hora de verano/invierno.

Toda operación de negocio debe pasar por `hoy_negocio()`/`ahora_negocio()` en
vez de por las funciones de `datetime` directamente (sprint de integridad,
2026-07-28)."""

from datetime import date, datetime
from zoneinfo import ZoneInfo

ZONA_NEGOCIO = ZoneInfo("Europe/Madrid")


def ahora_negocio() -> datetime:
    """La fecha y hora actuales, en la zona horaria del negocio."""
    return datetime.now(ZONA_NEGOCIO)


def hoy_negocio() -> date:
    """El día de calendario actual en Madrid — para decidir "hoy" en avisos,
    firmas de sesión y cálculos semanales/mensuales."""
    return ahora_negocio().date()
