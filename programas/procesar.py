"""Combina el resumen semanal de Calendar con los programas actuales de cada
cliente para calcular descuentos, avisos y renovaciones."""

from programas.logica import ActualizacionPrograma, actualizar_programa


def procesar_semana(sesiones_pt: dict[str, int], programas: dict[str, dict]) -> dict:
    """sesiones_pt: {cliente: nº sesiones esta semana} — viene del resumen de Calendar.
    programas: {cliente: {"sesiones_restantes": int, "sesiones_totales": int, "pendiente_pago": bool}}
                — vendrá de Notion cuando esté conectado.

    Devuelve los resultados por cliente y la lista de clientes detectados en
    Calendar que no tienen programa conocido (para que Fernando los revise
    antes de nada).
    """
    resultados: dict[str, ActualizacionPrograma] = {}
    sin_programa: list[str] = []

    for cliente, consumidas in sesiones_pt.items():
        programa = programas.get(cliente)
        if programa is None:
            sin_programa.append(cliente)
            continue

        resultados[cliente] = actualizar_programa(
            sesiones_restantes=programa["sesiones_restantes"],
            sesiones_totales=programa["sesiones_totales"],
            sesiones_consumidas=consumidas,
            pendiente_pago=programa.get("pendiente_pago", False),
        )

    return {"resultados": resultados, "sin_programa": sin_programa}
