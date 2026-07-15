"""CLI que clasifica eventos de Google Calendar y devuelve un resumen.

Uso: se le pasa por stdin, tal cual, el array `events` que devuelve el
conector de Google Calendar (cada objeto con su campo "summary" original) y
devuelve por stdout el resumen en JSON.

Importante: este script debe recibir el JSON exacto que devuelve el conector
(guardado en un archivo o redirigido directamente), nunca una lista de
títulos retipeada a mano — retipear a mano puede perder eventos por error
humano, como ya pasó una vez (ver .claude/skills/lessons-learned/log.md).
"""

import json
import sys

from calendar_integration.summary import resumir_semana


def main() -> None:
    eventos = json.loads(sys.stdin.read())
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
