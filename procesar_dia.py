"""Procesa un día suelto de Calendar (no una semana completa) y lo suma a
lo que ya hubiera esa semana — es el corazón de la actualización diaria
automática (ver `webapp/app.py`, ruta `/admin/procesar-dia`, y la rutina
programada en la nube que la llama cada noche).

Reutiliza exactamente la misma lógica que el cierre semanal manual
(`cierre_semanal/cli.py`) — mismos módulos, mismas reglas de negocio — así
que un día procesado aquí y luego "cerrado" a mano el domingo da el mismo
resultado que si todo se hubiera hecho de una vez. La diferencia es que
aquí no hay pantalla de confirmación: es Fernando quien decidió (2026-07-21)
que la actualización diaria vaya sola, con avisos a posteriori para lo que
no se pueda procesar automáticamente en vez de una pantalla de "revisa
antes de guardar"."""

from datetime import datetime

from avisos import registrar_aviso
from calendar_integration.semana import get_week_range
from calendar_integration.summary import resumir_semana
from clientes.repositorio import aplicar_actualizaciones, cargar_programas, cargar_tarifas, registrar_historial
from economia.calculo import calcular_desglose
from economia.registro import obtener_desglose_semana, obtener_semana, registrar_semana
from programas.procesar import procesar_semana


def procesar_dia(eventos: list[dict], fecha: str) -> dict:
    """eventos: array de eventos de Calendar tal cual los devuelve el
    conector, ya filtrados (o no) a un solo día — solo se usan los que
    caigan ese día. fecha: 'YYYY-MM-DD' del día a procesar."""
    fecha_referencia = datetime.strptime(fecha, "%Y-%m-%d")
    resumen_calendar = resumir_semana(eventos)

    programas, incompletos_datos = cargar_programas()
    resultado_programas = procesar_semana(resumen_calendar["sesiones_pt_fechas"], programas)

    aplicar_actualizaciones(resultado_programas["resultados"])
    registrar_historial(resultado_programas["historial"])

    tarifas = cargar_tarifas()
    desglose_dia = calcular_desglose(
        resumen_calendar["sesiones_pt"], tarifas, resumen_calendar["crossfit_lidomare"]
    )

    inicio, fin = get_week_range(fecha_referencia)
    clave_semana = inicio.date().isoformat()

    desglose_semana = obtener_desglose_semana(clave_semana)
    for tarifa, datos in desglose_dia.items():
        acumulado = desglose_semana.setdefault(tarifa, {"sesiones": 0, "facturacion": 0.0})
        acumulado["sesiones"] += datos["sesiones"]
        acumulado["facturacion"] += datos["facturacion"]

    semana_actual = obtener_semana(clave_semana)
    sesiones_kids_semana = (semana_actual["sesiones_kids"] if semana_actual else 0) + resumen_calendar["crossfit_kids"]

    registrar_semana(inicio.date(), fin.date(), desglose_semana, sesiones_kids_semana)

    for titulo in resumen_calendar["no_reconocidos"]:
        registrar_aviso(fecha, "no_reconocido", f'Evento sin clasificar: "{titulo}"')
    for cliente in resultado_programas["sin_programa"]:
        registrar_aviso(fecha, "sin_programa", f'"{cliente}" hizo una sesión de PT pero no tiene programa asignado')
    for cliente in incompletos_datos:
        registrar_aviso(fecha, "datos_incompletos", f'A "{cliente}" le faltan datos de programa por rellenar')

    clientes_ultima_sesion = []
    for cliente, actualizacion in resultado_programas["resultados"].items():
        if actualizacion.aviso_ultima_sesion:
            clientes_ultima_sesion.append(cliente)
            registrar_aviso(
                fecha, "ultima_sesion",
                f'"{cliente}" se ha quedado con 1 sola sesión de su bono — probablemente toque renovar pronto',
            )

    return {
        "fecha": fecha,
        "clientes_actualizados": list(resultado_programas["resultados"].keys()),
        "avisos_nuevos": (
            len(resumen_calendar["no_reconocidos"])
            + len(resultado_programas["sin_programa"])
            + len(incompletos_datos)
            + len(clientes_ultima_sesion)
        ),
    }
