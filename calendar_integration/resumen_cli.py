"""CLI que clasifica títulos de eventos de Google Calendar y devuelve un resumen.

Uso: se le pasa por stdin una lista JSON de títulos de eventos (strings), y
devuelve por stdout el resumen en JSON. Pensado para ser invocado desde el
skill `resumen-semanal`, que obtiene los eventos reales a través del conector
de Google Calendar ya autorizado (no hace falta ninguna credencial propia).
"""

import json
import sys

from calendar_integration.summary import resumir_semana


def main() -> None:
    titulos = json.loads(sys.stdin.read())
    eventos = [{"summary": titulo} for titulo in titulos]
    resumen = resumir_semana(eventos)

    salida = {
        "sesiones_pt": dict(resumen["sesiones_pt"]),
        "crossfit_lidomare": resumen["crossfit_lidomare"],
        "crossfit_kids": resumen["crossfit_kids"],
        "no_reconocidos": resumen["no_reconocidos"],
    }
    print(json.dumps(salida, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
