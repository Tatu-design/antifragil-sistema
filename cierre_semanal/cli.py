"""Une el resumen de Calendar con la lógica de programas de clientes.

Uso:
    python -m cierre_semanal.cli previsualizar < eventos.json   # solo calcula, no escribe
    python -m cierre_semanal.cli aplicar < eventos.json          # calcula Y escribe en el Excel

`eventos.json` debe ser el array de eventos tal cual lo devuelve el conector
de Google Calendar (nunca retipeado a mano — ver lección del 2026-07-14).

Los dos modos usan exactamente el mismo cálculo a partir de los mismos
eventos, así que lo que se previsualiza es exactamente lo que se escribiría.
Nunca se escribe nada salvo que se invoque el modo "aplicar" explícitamente,
después de que Fernando haya confirmado el resumen.
"""

import json
import sys
from dataclasses import asdict

from calendar_integration.summary import resumir_semana
from clientes.repositorio import aplicar_actualizaciones, cargar_programas
from programas.procesar import procesar_semana


def calcular(eventos: list[dict]) -> dict:
    resumen_calendar = resumir_semana(eventos)
    programas, incompletos_datos = cargar_programas()
    resultado_programas = procesar_semana(resumen_calendar["sesiones_pt"], programas)

    return {
        "crossfit_lidomare": resumen_calendar["crossfit_lidomare"],
        "crossfit_kids": resumen_calendar["crossfit_kids"],
        "no_reconocidos": resumen_calendar["no_reconocidos"],
        "sin_programa": resultado_programas["sin_programa"],
        "incompletos_datos": incompletos_datos,
        "resultados": resultado_programas["resultados"],
    }


def main() -> None:
    # En Windows, stdin/stdout no siempre son UTF-8 por defecto (cp1252),
    # lo que corrompe nombres con tildes como "Rocío" — ver lección del
    # 2026-07-15 en el log.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")

    modo = sys.argv[1] if len(sys.argv) > 1 else "previsualizar"
    eventos = json.loads(sys.stdin.read())
    calculo = calcular(eventos)

    if modo == "aplicar":
        aplicar_actualizaciones(calculo["resultados"])
        salida = {"escrito": True, "clientes_actualizados": list(calculo["resultados"].keys())}
    else:
        salida = {
            "crossfit_lidomare": calculo["crossfit_lidomare"],
            "crossfit_kids": calculo["crossfit_kids"],
            "no_reconocidos": calculo["no_reconocidos"],
            "sin_programa": calculo["sin_programa"],
            "incompletos_datos": calculo["incompletos_datos"],
            "resultados": {nombre: asdict(r) for nombre, r in calculo["resultados"].items()},
        }

    print(json.dumps(salida, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
