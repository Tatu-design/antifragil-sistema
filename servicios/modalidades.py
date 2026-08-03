"""Las tres modalidades de servicio y sus reglas (2026-08-03).

Este módulo NO toca la base de datos ni sabe nada de pantallas: solo
contiene las reglas de negocio de cada modalidad, como números que entran y
números que salen. Así se pueden probar exhaustivamente sin montar una base
de datos, y el resto del código no tiene que repetir estas decisiones en
cinco sitios distintos.

Las tres modalidades, en lenguaje llano:

**Bono** — el cliente compra por adelantado un paquete de N sesiones a un
precio total. Cada sesión que firma descuenta una del paquete y aporta su
parte proporcional a la facturación. Cuando se agota, el bono se cierra y
se abre otro igual, pendiente de pago.

**Mensualidad** — el cliente paga una cuota fija cada mes por mantener sus
plazas reservadas. Haga 9, 12 o 13 sesiones, la factura es la misma. Las
sesiones suman horas reales pero NO suman dinero: la cuota ya está contada.
Se renueva al cambiar de mes, nunca por número de sesiones.

**Cuenta de cliente** — el cliente paga al final por lo que realmente ha
hecho, a un precio por hora. No hay tope de sesiones ni renovación por
consumo: el periodo se cierra al cambiar de mes.

La diferencia que de verdad importa, y que atraviesa todo el proyecto:

    dinero producido  ≠  horas trabajadas  ≠  dinero cobrado

Marcar un ciclo como pagado solo cambia lo tercero. Nunca lo primero ni lo
segundo, ni hacia adelante ni hacia atrás.
"""

BONO = "bono"
MENSUALIDAD = "mensualidad"
CUENTA = "cuenta"

MODALIDADES = (BONO, MENSUALIDAD, CUENTA)

MODALIDAD_POR_DEFECTO = BONO

# Cómo se llama cada una en pantalla. Fernando no lee código.
ETIQUETAS = {
    BONO: "Bono",
    MENSUALIDAD: "Mensualidad",
    CUENTA: "Cuenta de cliente",
}

# Las modalidades cuyo ciclo va por mes natural, no por consumo.
MODALIDADES_MENSUALES = (MENSUALIDAD, CUENTA)


def validar_modalidad(modalidad: str) -> str:
    if modalidad not in MODALIDADES:
        raise ValueError(
            f"Modalidad de servicio no válida: '{modalidad}'. "
            f"Debe ser una de: {', '.join(MODALIDADES)}"
        )
    return modalidad


def _numero(valor, etiqueta: str, *, permitir_cero: bool = False) -> float:
    try:
        numero = float(valor)
    except (TypeError, ValueError):
        raise ValueError(f"{etiqueta} tiene que ser un número") from None
    if numero < 0 or (numero == 0 and not permitir_cero):
        raise ValueError(f"{etiqueta} tiene que ser mayor que cero")
    return numero


def validar_condiciones(
    modalidad: str,
    *,
    sesiones_totales=None,
    precio_total=None,
    cuota_mensual=None,
    tarifa=None,
    sesiones_referencia=None,
) -> dict:
    """Comprueba que las condiciones son coherentes con la modalidad y
    devuelve el juego de condiciones ya normalizado y completo.

    Rechaza combinaciones imposibles en vez de guardarlas y descubrir el
    problema semanas después en la facturación: un bono sin sesiones, una
    mensualidad sin cuota, una cuenta con tope, un bono con cuota mensual...

    Devuelve siempre las mismas claves, con `None` en las que esa modalidad
    no usa — así quien guarda no tiene que preguntarse cuáles tocan.
    """
    validar_modalidad(modalidad)

    if modalidad == BONO:
        if cuota_mensual not in (None, "", 0):
            raise ValueError("Un bono no lleva cuota mensual: se paga por el paquete de sesiones")
        sesiones = int(_numero(sesiones_totales, "El número de sesiones del bono"))
        total = _numero(precio_total, "El precio total del bono")
        return {
            "modalidad": BONO,
            "sesiones_totales": sesiones,
            "precio_total": round(total, 2),
            # El precio por sesión NO se pide: se calcula, para que no pueda
            # contradecir al precio total.
            "tarifa": round(total / sesiones, 2),
            "cuota_mensual": None,
            "sesiones_referencia": None,
        }

    if modalidad == MENSUALIDAD:
        if sesiones_totales not in (None, "", 0):
            raise ValueError(
                "Una mensualidad no tiene un número de sesiones que se consuma. "
                "Si quieres anotar las previstas, usa las sesiones de referencia."
            )
        cuota = _numero(cuota_mensual, "La cuota mensual")
        referencia = None
        if sesiones_referencia not in (None, "", 0):
            referencia = int(_numero(sesiones_referencia, "Las sesiones de referencia"))
        return {
            "modalidad": MENSUALIDAD,
            "sesiones_totales": None,
            "precio_total": None,
            # Deliberadamente sin tarifa por sesión: las sesiones de una
            # mensualidad no aportan dinero, solo horas. Si llevaran tarifa,
            # se cobraría dos veces el mismo mes.
            "tarifa": None,
            "cuota_mensual": round(cuota, 2),
            "sesiones_referencia": referencia,
        }

    if cuota_mensual not in (None, "", 0):
        raise ValueError("Una cuenta de cliente no lleva cuota mensual: se paga por lo realmente hecho")
    if sesiones_totales not in (None, "", 0):
        raise ValueError("Una cuenta de cliente no tiene tope de sesiones")
    precio = _numero(tarifa, "El precio por sesión")
    return {
        "modalidad": CUENTA,
        "sesiones_totales": None,
        "precio_total": None,
        "tarifa": round(precio, 2),
        "cuota_mensual": None,
        "sesiones_referencia": None,
    }


def consume_sesiones(modalidad: str) -> bool:
    """¿Firmar una sesión descuenta de un saldo? Solo en los bonos."""
    return validar_modalidad(modalidad) == BONO


def renueva_por_consumo(modalidad: str) -> bool:
    """¿El ciclo se cierra al agotar las sesiones? Solo en los bonos. Una
    mensualidad o una cuenta se cierran al cambiar de mes."""
    return validar_modalidad(modalidad) == BONO


def es_mensual(modalidad: str) -> bool:
    """¿El ciclo va por mes natural?"""
    return validar_modalidad(modalidad) in MODALIDADES_MENSUALES


def tarifa_de_la_sesion(modalidad: str, tarifa) -> float | None:
    """Cuánto dinero aporta a la economía UNA sesión firmada.

    En una mensualidad la respuesta es `None` (ninguno): la cuota completa
    del mes ya se registró aparte, así que sumar también cada sesión sería
    cobrar dos veces. La sesión sigue guardándose y sigue contando como hora
    trabajada — simplemente no lleva importe."""
    if validar_modalidad(modalidad) == MENSUALIDAD:
        return None
    return tarifa


def tiene_tope(modalidad: str) -> bool:
    """¿Tiene sentido hablar de "sesiones restantes"? Solo en los bonos."""
    return validar_modalidad(modalidad) == BONO


def precio_efectivo(facturacion: float | None, sesiones: int | None) -> float | None:
    """Lo que ha salido cada hora de verdad.

    En una mensualidad es la cuota dividida entre las sesiones que realmente
    se hicieron: 720 € entre 12 son 60 €/h, pero entre 9 son 80 €/h y entre
    13 son 55,38 €/h.

    Devuelve `None` si todavía no hay sesiones — nunca una división por cero
    ni un precio infinito en pantalla."""
    if not sesiones or facturacion is None:
        return None
    return round(facturacion / sesiones, 2)


def resumen_ciclo(ciclo: dict, sesiones_reales: int) -> dict:
    """Traduce un ciclo guardado a lo que hay que enseñar en pantalla,
    según su modalidad. Devuelve siempre las mismas claves para que la
    plantilla no tenga que decidir nada.

    `facturacion` es lo PRODUCIDO por ese ciclo, no lo cobrado: un ciclo
    pendiente de pago factura exactamente igual que uno pagado."""
    modalidad = ciclo.get("modalidad") or MODALIDAD_POR_DEFECTO
    validar_modalidad(modalidad)

    if modalidad == MENSUALIDAD:
        cuota = ciclo.get("cuota_mensual")
        return {
            "modalidad": modalidad,
            "etiqueta": ETIQUETAS[modalidad],
            "facturacion": cuota,
            "sesiones_reales": sesiones_reales,
            "sesiones_referencia": ciclo.get("sesiones_referencia"),
            "sesiones_restantes": None,
            "precio_efectivo": precio_efectivo(cuota, sesiones_reales),
            "muestra_barra": False,
        }

    if modalidad == CUENTA:
        tarifa = ciclo.get("tarifa") or 0
        facturacion = round(tarifa * sesiones_reales, 2)
        return {
            "modalidad": modalidad,
            "etiqueta": ETIQUETAS[modalidad],
            "facturacion": facturacion,
            "sesiones_reales": sesiones_reales,
            "sesiones_referencia": None,
            "sesiones_restantes": None,
            "precio_efectivo": ciclo.get("tarifa"),
            "muestra_barra": False,
        }

    totales = ciclo.get("sesiones_totales") or 0
    tarifa = ciclo.get("tarifa") or 0
    return {
        "modalidad": modalidad,
        "etiqueta": ETIQUETAS[modalidad],
        # Lo producido por el bono es lo que se lleva consumido, no el
        # paquete entero: las sesiones que aún no se han hecho todavía no se
        # han trabajado.
        "facturacion": round(tarifa * sesiones_reales, 2),
        "sesiones_reales": sesiones_reales,
        "sesiones_referencia": None,
        "sesiones_restantes": max(totales - sesiones_reales, 0) if totales else None,
        "precio_efectivo": ciclo.get("tarifa"),
        "muestra_barra": bool(totales),
    }
