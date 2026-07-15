"""Cálculo económico semanal: facturación por sesiones hechas (no por pagos
recibidos), agrupada por tarifa — igual que la hoja que ya usaba Fernando.

CrossFit Kids se factura por mensualidad (Fernando introduce la facturación
total del mes a mano), así que su precio por sesión no se conoce en el
momento de cerrar cada semana. Por eso se cuenta aparte, sin € todavía —
ver `economia/registro.py` para el reparto retroactivo una vez se conoce el
importe mensual.
"""

from collections import defaultdict

# Ver docs/TARIFAS.md — tarifa fija, no depende del cliente.
TARIFA_CROSSFIT_LIDOMARE = 15.0


def calcular_desglose(
    sesiones_pt: dict[str, int], tarifas_clientes: dict[str, float], sesiones_lidomare: int
) -> dict[float, dict]:
    """Agrupa las sesiones por tarifa (no por cliente). Devuelve
    {tarifa: {"sesiones": n, "facturacion": importe}}.

    Los clientes cuya tarifa no se conoce (sin programa asignado en el
    Excel) no se incluyen aquí — ya se avisan aparte como "sin_programa" en
    `programas.procesar`.
    """
    desglose: dict[float, dict] = defaultdict(lambda: {"sesiones": 0, "facturacion": 0.0})

    for cliente, sesiones in sesiones_pt.items():
        tarifa = tarifas_clientes.get(cliente)
        if tarifa is None:
            continue
        tarifa = float(tarifa)
        desglose[tarifa]["sesiones"] += sesiones
        desglose[tarifa]["facturacion"] += sesiones * tarifa

    if sesiones_lidomare:
        desglose[TARIFA_CROSSFIT_LIDOMARE]["sesiones"] += sesiones_lidomare
        desglose[TARIFA_CROSSFIT_LIDOMARE]["facturacion"] += sesiones_lidomare * TARIFA_CROSSFIT_LIDOMARE

    return dict(desglose)


def resumir(desglose: dict[float, dict]) -> dict:
    """Facturación total, horas totales y precio medio por hora a partir del
    desglose por tarifa (PT + CrossFit Lidomare; Kids se suma aparte cuando
    se conozca su importe mensual)."""
    horas_totales = sum(d["sesiones"] for d in desglose.values())
    facturacion_total = sum(d["facturacion"] for d in desglose.values())
    precio_medio_hora = facturacion_total / horas_totales if horas_totales else 0.0

    return {
        "facturacion_total": facturacion_total,
        "horas_totales": horas_totales,
        "precio_medio_hora": precio_medio_hora,
    }
