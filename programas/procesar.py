"""Combina el resumen semanal de Calendar con los programas actuales de cada
cliente para calcular descuentos, avisos y renovaciones."""

from programas.logica import ActualizacionPrograma, actualizar_programa


def procesar_una_sesion(programa: dict) -> tuple[ActualizacionPrograma, int]:
    """Descuenta una única sesión de un programa y devuelve el resultado
    junto al número de bono que le corresponde a esa sesión concreta. Es la
    pieza compartida entre el cierre semanal por lotes (`procesar_semana`,
    fecha a fecha) y el registro de asistencia en el momento
    (`registrar_asistencia.py`, 2026-07-22) — misma lógica de renovación,
    solo cambia si se llama una vez o muchas seguidas."""
    paso = actualizar_programa(
        sesiones_restantes=programa["sesiones_restantes"],
        sesiones_totales=programa["sesiones_totales"],
        sesiones_consumidas=1,
        pendiente_pago=programa.get("pendiente_pago", False),
    )
    # Si esta sesión agota el bono en curso, es la ÚLTIMA de ese bono
    # (numero_sesion = totales), no la primera del bono nuevo que empieza
    # justo después.
    numero_sesion = (
        programa["sesiones_totales"] if paso.renovado else programa["sesiones_totales"] - paso.sesiones_restantes
    )
    return paso, numero_sesion


def procesar_semana(sesiones_pt_fechas: dict[str, list[str]], programas: dict[str, dict]) -> dict:
    """sesiones_pt_fechas: {cliente: [fechas ISO de sus sesiones esta semana]}
                — viene del resumen de Calendar.
    programas: {cliente: {"sesiones_restantes": int, "sesiones_totales": int,
                "pendiente_pago": bool, "tipo_programa": str}}
                — vendrá de Notion cuando esté conectado.

    Procesa las sesiones de cada cliente fecha a fecha (no de golpe) para
    poder saber, además del resultado final de la semana, a qué número de
    bono corresponde cada fecha concreta — es el historial de sesiones que
    Fernando (y a futuro cada cliente) puede consultar.

    Devuelve los resultados por cliente, la lista de clientes detectados en
    Calendar que no tienen programa conocido, y el historial fecha a fecha.
    """
    resultados: dict[str, ActualizacionPrograma] = {}
    sin_programa: list[str] = []
    historial: dict[str, list[dict]] = {}

    for cliente, fechas in sesiones_pt_fechas.items():
        programa = programas.get(cliente)
        if programa is None:
            sin_programa.append(cliente)
            continue

        restantes = programa["sesiones_restantes"]
        totales = programa["sesiones_totales"]
        pendiente_pago = programa.get("pendiente_pago", False)
        renovado_semana = False
        entradas: list[dict] = []

        for fecha in fechas:
            paso, numero_sesion = procesar_una_sesion(
                {"sesiones_restantes": restantes, "sesiones_totales": totales, "pendiente_pago": pendiente_pago}
            )

            restantes = paso.sesiones_restantes
            pendiente_pago = paso.pendiente_pago
            renovado_semana = renovado_semana or paso.renovado

            entradas.append(
                {
                    "fecha": fecha,
                    "numero_sesion": numero_sesion,
                    "sesiones_totales": totales,
                    "tipo_programa": programa.get("tipo_programa", ""),
                }
            )

        historial[cliente] = entradas
        resultados[cliente] = ActualizacionPrograma(
            sesiones_restantes=restantes,
            renovado=renovado_semana,
            pendiente_pago=pendiente_pago,
            aviso_ultima_sesion=(restantes == 1),
        )

    return {"resultados": resultados, "sin_programa": sin_programa, "historial": historial}
