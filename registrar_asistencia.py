"""Registro de asistencia en el momento — decisión de Fernando del
2026-07-22: en vez de perseguir una automatización con Calendar que no se
podía verificar, cada sesión de PT se confirma con un toque nada más
terminarla (desde el móvil de Fernando), y las clases de grupo (CrossFit
Lidomare/Kids, que no son de un cliente concreto) se cuentan con un botón
aparte. Sustituye a Calendar como fuente del día a día — Calendar sigue
sirviendo para planificar, pero ya no hace falta leerlo para contar
sesiones.

Reutiliza la misma lógica de renovación de bonos (`programas.procesar`) y
el mismo reparto económico semanal aditivo (`obtener_desglose_semana`) que
ya se construyó para la actualización diaria automática — la diferencia es
que aquí se registra una sesión cada vez, al momento, no un día entero de
golpe."""

from datetime import date, datetime

from avisos import registrar_aviso
from basedatos import RUTA_POR_DEFECTO, conectar
from calendar_integration.semana import get_week_range
from clientes.repositorio import (
    aplicar_actualizaciones,
    cargar_programas,
    cargar_tarifas,
    editar_historial,
    eliminar_historial,
    marcar_pendiente_pago,
    obtener_historial,
    registrar_historial,
)
from economia.calculo import TARIFA_CROSSFIT_LIDOMARE
from economia.registro import (
    obtener_desglose_semana,
    obtener_semana,
    registrar_semana,
    verificar_sincronizacion_semana,
)
from programas.procesar import procesar_una_sesion


def _sumar_a_semana(fecha: date, tarifa: float | None, sesiones_extra: int, kids_extra: int) -> None:
    inicio, fin = get_week_range(datetime.combine(fecha, datetime.min.time()))
    clave = inicio.date().isoformat()

    desglose = obtener_desglose_semana(clave)
    if tarifa is not None:
        entrada = desglose.setdefault(tarifa, {"sesiones": 0, "facturacion": 0.0})
        entrada["sesiones"] += sesiones_extra
        entrada["facturacion"] += sesiones_extra * tarifa

    semana_actual = obtener_semana(clave)
    sesiones_kids = (semana_actual["sesiones_kids"] if semana_actual else 0) + kids_extra

    registrar_semana(inicio.date(), fin.date(), desglose, sesiones_kids)
    _comprobar_sincronizacion(inicio.date(), fin.date(), desglose)


def _comprobar_sincronizacion(inicio: date, fin: date, desglose_guardado: dict[float, dict]) -> None:
    """Tras cualquier cambio que toque la economía de una semana, comprueba
    al momento que el historial y `desglose` siguen coincidiendo — así, si
    algo se desincroniza (el bug que motivó esto, 2026-07-23: una sesión
    de Felipe y Javi quedó contada dos veces de más en la economía sin
    tener una fila correspondiente en el historial), Fernando se entera el
    mismo día en Avisos en vez de detectarlo semanas después comparando con
    su propia hoja de cálculo.

    Recibe el desglose ya guardado en vez de volver a leerlo de la base de
    datos — recién escrito por `_sumar_a_semana`, así que ya se conoce sin
    abrir otra conexión más (optimización del 2026-07-24)."""
    for detalle in verificar_sincronizacion_semana(inicio, fin, desglose_guardado=desglose_guardado):
        registrar_aviso(date.today().isoformat(), "discrepancia_economica", detalle)


def registrar_sesion_pt(nombre: str, fecha: date | None = None) -> dict:
    """Confirma una sesión de PT de un cliente concreto: descuenta del
    bono (con renovación automática si tocaba), guarda la fecha en su
    historial, y suma la sesión a la economía de esta semana.

    Un cliente puede tener varias sesiones firmadas el mismo día si hace
    falta (decisión de Fernando, 2026-07-24 — antes esto se bloqueaba, pero
    resultó ser una funcionalidad real que necesitaba, no solo un caso de
    error). El botón "Firmar sesión" del navegador se desactiva nada más
    pulsarlo para evitar un doble toque accidental (ver `perfil_cliente.html`),
    que sigue siendo el motivo real por el que esto podía descuadrar la
    economía."""
    fecha = fecha or date.today()
    programas, incompletos = cargar_programas()

    if nombre in incompletos:
        raise ValueError(f"A '{nombre}' le faltan datos de programa por rellenar — revísalo en Editar cliente")
    programa = programas.get(nombre)
    if programa is None:
        raise ValueError(f"'{nombre}' no tiene un programa asignado")

    paso, numero_sesion = procesar_una_sesion(programa)
    tarifa = cargar_tarifas().get(nombre)

    aplicar_actualizaciones({nombre: paso})
    registrar_historial(
        {
            nombre: [
                {
                    "fecha": fecha.isoformat(),
                    "numero_sesion": numero_sesion,
                    "sesiones_totales": programa["sesiones_totales"],
                    "tipo_programa": programa["tipo_programa"],
                    "tarifa": tarifa,
                }
            ]
        }
    )

    _sumar_a_semana(fecha, tarifa, sesiones_extra=1, kids_extra=0)

    # Avisos para que Fernando se entere sin tener que estar mirando la
    # lista de clientes — decisión del 2026-07-22.
    if paso.renovado:
        registrar_aviso(
            fecha.isoformat(), "bono_terminado",
            f"'{nombre}' ha terminado su bono y el nuevo queda pendiente de pago",
        )
    elif paso.aviso_ultima_sesion:
        registrar_aviso(
            fecha.isoformat(), "ultima_sesion",
            f"'{nombre}' se ha quedado con 1 sola sesión de su bono — la próxima vez tocará renovar",
        )

    return {
        "numero_sesion": numero_sesion,
        "sesiones_totales": programa["sesiones_totales"],
        "renovado": paso.renovado,
        "aviso_ultima_sesion": paso.aviso_ultima_sesion,
    }


def editar_sesion_pt(entrada_id: int, nueva_fecha: str, nuevo_numero_sesion: int) -> dict:
    """Corrige una entrada del historial ya guardada (p. ej. un número de
    sesión equivocado). Cada entrada se identifica por su `id` — un cliente
    puede tener varias sesiones el mismo día (decisión de Fernando,
    2026-07-24). Si el cambio de fecha mueve la sesión a otra semana, la
    economía se traslada de una semana a la otra para seguir cuadrando
    (decisión de Fernando del 2026-07-22)."""
    with conectar(RUTA_POR_DEFECTO) as conexion:
        fecha_original = conexion.execute(
            "SELECT fecha FROM historial_sesiones WHERE id = ?", (entrada_id,)
        ).fetchone()
    if fecha_original is None:
        raise ValueError("Esa entrada del historial ya no existe")
    fecha_original = fecha_original["fecha"]

    resultado = editar_historial(entrada_id, nueva_fecha, nuevo_numero_sesion)

    if fecha_original == nueva_fecha:
        return resultado

    tarifa = cargar_tarifas().get(resultado["cliente"])
    if tarifa is None:
        return resultado

    fecha_original_d = date.fromisoformat(fecha_original)
    nueva_fecha_d = date.fromisoformat(nueva_fecha)
    semana_original = get_week_range(datetime.combine(fecha_original_d, datetime.min.time()))[0].date()
    semana_nueva = get_week_range(datetime.combine(nueva_fecha_d, datetime.min.time()))[0].date()

    if semana_original != semana_nueva:
        _sumar_a_semana(fecha_original_d, tarifa, sesiones_extra=-1, kids_extra=0)
        _sumar_a_semana(nueva_fecha_d, tarifa, sesiones_extra=1, kids_extra=0)

    return resultado


def eliminar_sesion_pt(entrada_id: int) -> dict:
    """Borra una entrada del historial (por su `id`) y deshace su
    aportación económica de esa semana (p. ej. un toque de más en "Firmar
    sesión" que creó una entrada de más).

    Si la sesión borrada era la más reciente del cliente y completaba su
    bono (probablemente disparó una renovación automática, con el nuevo
    bono marcado pendiente de pago), esa renovación se deshace también —
    si no, el cliente se quedaría marcado "pendiente de pago" por un bono
    que, según el historial que queda, nunca llegó a completarse (decisión
    de Fernando, 2026-07-24, verificando que borrar una sesión deja todo
    consistente)."""
    with conectar(RUTA_POR_DEFECTO) as conexion:
        previa = conexion.execute(
            "SELECT cliente FROM historial_sesiones WHERE id = ?", (entrada_id,)
        ).fetchone()
    if previa is None:
        raise ValueError("Esa entrada del historial ya no existe")
    cliente = previa["cliente"]

    historial_previo = obtener_historial(cliente)
    era_la_mas_reciente = bool(historial_previo) and historial_previo[0]["id"] == entrada_id

    entrada = eliminar_historial(entrada_id)

    deshizo_renovacion = False
    if era_la_mas_reciente and entrada["numero_sesion"] == entrada["sesiones_totales"]:
        marcar_pendiente_pago(cliente, False)
        deshizo_renovacion = True

    tarifa = cargar_tarifas().get(cliente)
    if tarifa is not None:
        _sumar_a_semana(date.fromisoformat(entrada["fecha"]), tarifa, sesiones_extra=-1, kids_extra=0)

    entrada["deshizo_renovacion"] = deshizo_renovacion
    return entrada


def registrar_clase_grupo(tipo: str, fecha: date | None = None) -> None:
    """tipo: 'lidomare' (con tarifa fija) o 'kids' (sin facturación hasta
    que Fernando indique el importe mensual — ver economia/registro.py).

    Queda anotada con su fecha en `clases_grupo` (no solo sumada al total
    de la semana) para poder deshacerla si se pulsa por error
    (`eliminar_ultima_clase_grupo`) y para poder comprobar que sigue
    cuadrando con la economía — mismo tratamiento que las sesiones de PT
    desde el 2026-07-23 (decisión de Fernando, 2026-07-24)."""
    fecha = fecha or date.today()
    if tipo not in ("lidomare", "kids"):
        raise ValueError(f"Tipo de clase desconocido: {tipo}")

    with conectar(RUTA_POR_DEFECTO) as conexion:
        conexion.execute("INSERT INTO clases_grupo (fecha, tipo) VALUES (?, ?)", (fecha.isoformat(), tipo))

    if tipo == "lidomare":
        _sumar_a_semana(fecha, TARIFA_CROSSFIT_LIDOMARE, sesiones_extra=1, kids_extra=0)
    else:
        _sumar_a_semana(fecha, None, sesiones_extra=0, kids_extra=1)


def eliminar_ultima_clase_grupo(tipo: str) -> dict:
    """Deshace la clase de grupo más reciente de este tipo (p. ej. un toque
    de más en "+1 CrossFit Lidomare/Kids") y su aportación económica."""
    if tipo not in ("lidomare", "kids"):
        raise ValueError(f"Tipo de clase desconocido: {tipo}")

    with conectar(RUTA_POR_DEFECTO) as conexion:
        fila = conexion.execute(
            "SELECT id, fecha FROM clases_grupo WHERE tipo = ? ORDER BY id DESC LIMIT 1", (tipo,)
        ).fetchone()
        if fila is None:
            raise ValueError(f"No hay ninguna clase de '{tipo}' registrada todavía")
        conexion.execute("DELETE FROM clases_grupo WHERE id = ?", (fila["id"],))

    fecha = date.fromisoformat(fila["fecha"])
    if tipo == "lidomare":
        _sumar_a_semana(fecha, TARIFA_CROSSFIT_LIDOMARE, sesiones_extra=-1, kids_extra=0)
    else:
        _sumar_a_semana(fecha, None, sesiones_extra=0, kids_extra=-1)

    return {"fecha": fila["fecha"], "tipo": tipo}
