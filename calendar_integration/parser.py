"""Clasificación de eventos del calendario según SYSTEM_VISION.md:

- "PT + Nombre" -> entrenamiento personal de un cliente
- "CrossFit Lidomare" -> clase de CrossFit Lidomare
- "CrossFit Kids" -> clase de CrossFit Kids

El formato exacto de los títulos se ajustará con Fernando al probar con su
calendario real; esta es una primera aproximación razonable.
"""

from dataclasses import dataclass
from typing import Optional

PT_PREFIX = "pt"
CROSSFIT_LIDOMARE = "crossfit lidomare"
CROSSFIT_KIDS = "crossfit kids"


@dataclass
class SesionDetectada:
    tipo: str  # "pt" | "crossfit_lidomare" | "crossfit_kids"
    cliente: Optional[str]  # solo para "pt"
    titulo_original: str


def clasificar_evento(titulo: str) -> Optional[SesionDetectada]:
    """Clasifica el título de un evento. Devuelve None si no coincide con ningún tipo conocido."""
    if not titulo:
        return None

    texto = titulo.strip().lower()

    if texto == CROSSFIT_KIDS:
        return SesionDetectada(tipo="crossfit_kids", cliente=None, titulo_original=titulo)

    if texto == CROSSFIT_LIDOMARE:
        return SesionDetectada(tipo="crossfit_lidomare", cliente=None, titulo_original=titulo)

    if texto.startswith(PT_PREFIX):
        resto = titulo.strip()[len(PT_PREFIX):].strip(" +-").strip()
        if resto:
            return SesionDetectada(tipo="pt", cliente=resto, titulo_original=titulo)

    return None
