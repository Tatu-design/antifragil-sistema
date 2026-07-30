"""Une el resumen de Calendar con la lógica de programas de clientes y el
cálculo económico semanal.

Uso:
    python -m cierre_semanal.cli previsualizar [YYYY-MM-DD] < eventos.json

`YYYY-MM-DD` es cualquier día de la semana a procesar (por defecto, hoy).
`eventos.json` debe ser el array de eventos tal cual lo devuelve el conector
de Google Calendar (nunca retipeado a mano — ver lección del 2026-07-14).

**Solo previsualización.** El modo `aplicar` está retirado desde la segunda
auditoría (2026-07-30): escribía bonos y economía por lotes desde Calendar,
un segundo camino capaz de descontar el mismo bono que la firma manual (la
fuente activa desde el 2026-07-22) y de sobrescribir la economía de una
semana ya firmada. Si se invoca, avisa y termina sin escribir nada.

Calendar sigue siendo útil como COMPROBACIÓN: esta previsualización para
mirar a mano, y `/admin/verificar-semana` para que las diferencias queden
registradas como aviso.
"""

import json
import sys
from dataclasses import asdict
from datetime import datetime

from zona_horaria import ahora_negocio

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
    # lo que corrompe nombres con tildes como "Clienta Ángela" — ver lección del
    # 2026-07-15 en el log.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")

    modo = sys.argv[1] if len(sys.argv) > 1 else "previsualizar"
    fecha_arg = sys.argv[2] if len(sys.argv) > 2 else None
    fecha_referencia = datetime.strptime(fecha_arg, "%Y-%m-%d") if fecha_arg else ahora_negocio()

    eventos = json.loads(sys.stdin.read())
    calculo = calcular(eventos, fecha_referencia)

    if modo == "aplicar":
        # BLOQUEADO en la segunda auditoría (2026-07-30).
        #
        # Este modo descontaba bonos y reescribía la semana económica por
        # lotes desde Calendar. Desde el 2026-07-22 la fuente activa es la
        # firma manual en la app, y tener dos caminos capaces de descontar el
        # mismo bono es exactamente la causa de descuadre que esta auditoría
        # venía a eliminar: `registrar_semana` aquí SUSTITUYE el desglose de
        # la semana, así que aplicarlo hoy borraría de un golpe la economía
        # de las sesiones firmadas a mano.
        #
        # La previsualización sigue disponible: es de solo lectura y sigue
        # sirviendo para comparar Calendar con lo firmado.
        salida = {
            "escrito": False,
            "error": "modo 'aplicar' retirado",
            "detalle": (
                "Las sesiones se firman una a una en la app (fuente activa desde el 2026-07-22). "
                "Aplicar un cierre por lotes desde Calendar sobrescribiría la economía de esa semana. "
                "Usa 'previsualizar' para comparar, o /admin/verificar-semana para que las diferencias "
                "queden como aviso."
            ),
        }
        print(json.dumps(salida, ensure_ascii=False, indent=2))
        raise SystemExit(1)
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
