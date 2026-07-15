"""Lógica de descuento y renovación de programas de Entrenamiento Personal.

Reglas de negocio confirmadas por Fernando (SYSTEM_VISION.md y decisión del
2026-07-15): al agotarse un bono a mitad de semana, se inicia uno nuevo de
forma automática y las sesiones "de más" de esa misma semana ya cuentan
contra el bono nuevo. El bono nuevo se marca como pendiente de pago.

Esta lógica es independiente de dónde viva el dato (hoy no hay Notion
conectado todavía): solo opera sobre números que le pasan, no lee ni escribe
en ningún sitio.
"""

from dataclasses import dataclass


@dataclass
class ActualizacionPrograma:
    sesiones_restantes: int
    renovado: bool
    pendiente_pago: bool
    aviso_ultima_sesion: bool


def actualizar_programa(
    sesiones_restantes: int,
    sesiones_totales: int,
    sesiones_consumidas: int,
    pendiente_pago: bool,
) -> ActualizacionPrograma:
    """Descuenta las sesiones consumidas esta semana y renueva si hace falta.

    Si el bono se agota (llega a 0 o menos), se renueva automáticamente con
    el mismo número de sesiones (`sesiones_totales`) y se marca como
    pendiente de pago. Si el exceso de sesiones consumidas es mayor que un
    bono entero, se sigue renovando hasta que quede un resto positivo.
    """
    restantes = sesiones_restantes - sesiones_consumidas
    renovado = False

    while restantes <= 0:
        restantes += sesiones_totales
        renovado = True
        pendiente_pago = True

    return ActualizacionPrograma(
        sesiones_restantes=restantes,
        renovado=renovado,
        pendiente_pago=pendiente_pago,
        aviso_ultima_sesion=(restantes == 1),
    )
