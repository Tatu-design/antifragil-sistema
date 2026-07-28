"""Verificación semanal contra Calendar — decisión de Fernando del
2026-07-22: desde que las sesiones se confirman a mano ("firmar sesión"),
Calendar ya no es la fuente de datos del día a día, pero sigue sirviendo
como comprobación al final de la semana — ¿coincide lo firmado en la app
con lo que realmente hay en Calendar?

Esto es de solo lectura: nunca corrige nada por su cuenta. Cualquier
discrepancia se guarda como aviso (`avisos.py`) para que Fernando la
revise cuando quiera — nunca bloquea ni escribe sobre clientes/economía."""

from datetime import datetime

from avisos import registrar_aviso
from calendar_integration.semana import get_week_range
from calendar_integration.summary import resumir_semana
from clientes.repositorio import leer_clientes, obtener_historial
from economia.calculo import TARIFA_CROSSFIT_LIDOMARE
from economia.registro import obtener_desglose_semana, obtener_semana, verificar_sincronizacion_semana


def verificar_semana(eventos: list[dict], fecha_referencia: datetime) -> dict:
    inicio, fin = get_week_range(fecha_referencia)
    clave_semana = inicio.date().isoformat()
    resumen = resumir_semana(eventos)

    discrepancias: list[str] = []
    clientes = leer_clientes()

    # Todos los clientes a comprobar: los que aparecen en Calendar esta
    # semana + los que tienen alguna sesión firmada esta semana en la app
    # (si no, una sesión firmada sin ningún evento en Calendar nunca se
    # detectaría, al no aparecer nunca en sesiones_pt_fechas).
    nombres_a_comprobar = set(resumen["sesiones_pt_fechas"].keys()) | {
        nombre for nombre in clientes
        if any(inicio.date().isoformat() <= h["fecha"] <= fin.date().isoformat() for h in obtener_historial(nombre))
    }

    for cliente in sorted(nombres_a_comprobar):
        fechas_calendar = resumen["sesiones_pt_fechas"].get(cliente, [])
        if cliente not in clientes:
            discrepancias.append(f"Calendar tiene sesiones de \"{cliente}\" pero no existe ese cliente en la app")
            continue

        fechas_firmadas_semana = {
            h["fecha"] for h in obtener_historial(cliente) if inicio.date().isoformat() <= h["fecha"] <= fin.date().isoformat()
        }
        fechas_calendar_set = set(fechas_calendar)

        faltan_por_firmar = sorted(fechas_calendar_set - fechas_firmadas_semana)
        firmadas_sin_calendar = sorted(fechas_firmadas_semana - fechas_calendar_set)

        if faltan_por_firmar:
            discrepancias.append(
                f"'{cliente}': en Calendar el {', '.join(faltan_por_firmar)}, pero no está firmada en la app"
            )
        if firmadas_sin_calendar:
            discrepancias.append(
                f"'{cliente}': firmada en la app el {', '.join(firmadas_sin_calendar)}, pero no aparece en Calendar esa semana"
            )

    for titulo in resumen["no_reconocidos"]:
        discrepancias.append(f'Evento de Calendar sin clasificar: "{titulo}"')

    semana_app = obtener_semana(clave_semana)
    kids_app = semana_app["sesiones_kids"] if semana_app else 0
    if resumen["crossfit_kids"] != kids_app:
        discrepancias.append(
            f"CrossFit Kids: Calendar tiene {resumen['crossfit_kids']} clases esta semana, la app tiene {kids_app}"
        )

    desglose_app = obtener_desglose_semana(clave_semana)
    lidomare_app = desglose_app.get(TARIFA_CROSSFIT_LIDOMARE, {}).get("sesiones", 0)
    if resumen["crossfit_lidomare"] != lidomare_app:
        discrepancias.append(
            f"CrossFit Lidomare: Calendar tiene {resumen['crossfit_lidomare']} clases esta semana, la app tiene {lidomare_app}"
        )

    fecha_hoy = datetime.now().date().isoformat()
    for detalle in discrepancias:
        registrar_aviso(fecha_hoy, "discrepancia_calendar", detalle)

    # Además de comparar con Calendar, se comprueba que el historial de
    # sesiones y la economía de la semana sigan coincidiendo entre sí —
    # esto no depende de Calendar, así que se avisa aparte (2026-07-23).
    discrepancias_economia = verificar_sincronizacion_semana(inicio.date(), fin.date())
    for detalle in discrepancias_economia:
        registrar_aviso(fecha_hoy, "discrepancia_economica", detalle)

    return {
        "semana": f"{inicio.date()} a {fin.date()}",
        "discrepancias": discrepancias + discrepancias_economia,
    }
