"""Une el resumen de Calendar con la lógica de programas de clientes y el
cálculo económico semanal.

Uso:
    python -m cierre_semanal.cli previsualizar [YYYY-MM-DD] < eventos.json
    python -m cierre_semanal.cli aplicar [YYYY-MM-DD] < eventos.json

`YYYY-MM-DD` es cualquier día de la semana a procesar (por defecto, hoy).
`eventos.json` debe ser el array de eventos tal cual lo devuelve el conector
de Google Calendar (nunca retipeado a mano — ver lección del 2026-07-14).

Los dos modos usan exactamente el mismo cálculo a partir de los mismos
eventos, así que lo que se previsualiza es exactamente lo que se escribiría.
"aplicar" actualiza los clientes Y registra la semana económica en
`datos/antifragil.db` (SQLite) — solo debe invocarse tras confirmación
explícita de Fernando.
"""

import json
import sys
from dataclasses import asdict
from datetime import datetime

from calendar_integration.semana import get_week_range
from calendar_integration.summary import resumir_semana
from clientes.repositorio import aplicar_actualizaciones, cargar_programas, cargar_tarifas, registrar_historial
from economia.calculo import calcular_desglose
from economia.calculo import resumir as resumir_economia
from economia.registro import registrar_semana
from programas.procesar import procesar_semana
from sincronizar_servidor import sincronizar


def calcular(eventos: list[dict], fecha_referencia: datetime) -> dict:
    resumen_calendar = resumir_semana(eventos)
    programas, incompletos_datos = cargar_programas()
    resultado_programas = procesar_semana(resumen_calendar["sesiones_pt_fechas"], programas)

    tarifas = cargar_tarifas()
    desglose = calcular_desglose(
        resumen_calendar["sesiones_pt"], tarifas, resumen_calendar["crossfit_lidomare"]
    )

    inicio, fin = get_week_range(fecha_referencia)

    return {
        "fecha_inicio": inicio.date(),
        "fecha_fin": fin.date(),
        "crossfit_lidomare": resumen_calendar["crossfit_lidomare"],
        "crossfit_kids": resumen_calendar["crossfit_kids"],
        "no_reconocidos": resumen_calendar["no_reconocidos"],
        "sin_programa": resultado_programas["sin_programa"],
        "incompletos_datos": incompletos_datos,
        "resultados": resultado_programas["resultados"],
        "historial": resultado_programas["historial"],
        "desglose_tarifas": desglose,
        "resumen_economico": resumir_economia(desglose),
    }


def main() -> None:
    # En Windows, stdin/stdout no siempre son UTF-8 por defecto (cp1252),
    # lo que corrompe nombres con tildes como "Rocío" — ver lección del
    # 2026-07-15 en el log.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")

    modo = sys.argv[1] if len(sys.argv) > 1 else "previsualizar"
    fecha_arg = sys.argv[2] if len(sys.argv) > 2 else None
    fecha_referencia = datetime.strptime(fecha_arg, "%Y-%m-%d") if fecha_arg else datetime.now()

    eventos = json.loads(sys.stdin.read())
    calculo = calcular(eventos, fecha_referencia)

    if modo == "aplicar":
        aplicar_actualizaciones(calculo["resultados"])
        registrar_historial(calculo["historial"])
        registrar_semana(
            calculo["fecha_inicio"], calculo["fecha_fin"],
            calculo["desglose_tarifas"], calculo["crossfit_kids"],
        )
        mensaje_servidor = sincronizar()
        salida = {
            "escrito": True,
            "clientes_actualizados": list(calculo["resultados"].keys()),
            "servidor": mensaje_servidor,
        }
    else:
        salida = {
            "semana": f'{calculo["fecha_inicio"]} a {calculo["fecha_fin"]}',
            "crossfit_lidomare": calculo["crossfit_lidomare"],
            "crossfit_kids": calculo["crossfit_kids"],
            "no_reconocidos": calculo["no_reconocidos"],
            "sin_programa": calculo["sin_programa"],
            "incompletos_datos": calculo["incompletos_datos"],
            "resultados": {nombre: asdict(r) for nombre, r in calculo["resultados"].items()},
            "historial": calculo["historial"],
            "desglose_tarifas": calculo["desglose_tarifas"],
            "resumen_economico": calculo["resumen_economico"],
        }

    print(json.dumps(salida, ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    main()
