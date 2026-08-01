"""Confirmación pública de sesión desde el enlace personal del cliente
(`/mi/<token>`) — decisión de Fernando, 2026-07-29.

Primer diseño (mismo día): el cliente podía firmar su propia sesión desde
su enlace, creando una entrada nueva en su historial. Se detectó un riesgo
real antes de desplegarlo del todo: si Fernando ya había firmado la sesión
de ese cliente desde su perfil, y el cliente también confirmaba desde el
suyo, se contaban dos sesiones por un solo entrenamiento — el mismo tipo
de descuadre que el sprint de integridad del día anterior arregló para
Pareja C.

Segundo diseño (mismo día): el cliente nunca crea nada, solo confirma la
sesión que Fernando ya registró — pero la confirmación se guardaba por
**día**, no por sesión concreta. Fernando puede firmar varias sesiones el
mismo cliente el mismo día (decisión del 2026-07-24, sin cambios) — con
ese diseño, la primera confirmación del día "gastaba" el turno y las
siguientes sesiones de ese mismo día ya no se podían confirmar. Corregido
el mismo día: cada fila de `firmas_publicas` referencia ahora la sesión
concreta (`historial_sesiones.id`) que confirma, así que firmar tres
sesiones el mismo día da pie a tres confirmaciones independientes.

Fernando sigue firmando exactamente igual que siempre
(`registrar_sesion_pt`, sin cambios). El cliente solo puede **confirmar**
una sesión ya registrada — una anotación aparte que no toca el bono, el
historial ni la economía en absoluto. Si Fernando firmó una sesión y el
cliente nunca la confirmó, se lo decimos con un aviso — no en el momento
(no hay forma fiable de avisar en tiempo real, ver lección de la
actualización diaria de Calendar), sino la próxima vez que Fernando abra
la web, igual que funciona el resto de avisos."""

from datetime import date
from pathlib import Path

from avisos import registrar_aviso
from basedatos import RUTA_POR_DEFECTO, conectar
from zona_horaria import ahora_negocio, hoy_negocio

# El día en que se desplegó esta función — nunca se avisa de sesiones
# anteriores a esta fecha, porque confirmar no era ni posible entonces
# (si no, cada sesión antigua de la vida de la app aparecería como "sin
# confirmar" de golpe, como pasó la primera vez que se probó esto).
FECHA_INICIO_CONFIRMACIONES = date(2026, 7, 29)


def _sesion_pendiente(conexion, cliente: str, fecha: str) -> dict | None:
    """La sesión de esa fecha para este cliente que todavía no tiene una
    confirmación asociada, si la hay — la más reciente primero (por si
    Fernando firmó varias)."""
    fila = conexion.execute(
        "SELECT id, numero_sesion FROM historial_sesiones "
        "WHERE cliente = ? AND fecha = ? AND id NOT IN ("
        "  SELECT sesion_id FROM firmas_publicas WHERE sesion_id IS NOT NULL"
        ") ORDER BY id DESC LIMIT 1",
        (cliente, fecha),
    ).fetchone()
    return dict(fila) if fila else None


def hay_sesion_pendiente_de_confirmar(cliente: str, ruta: Path = RUTA_POR_DEFECTO) -> bool:
    """True si hay alguna sesión de hoy de este cliente que Fernando ya
    firmó y el cliente todavía no ha confirmado — condición para mostrar
    el botón/QR de confirmar."""
    with conectar(ruta) as conexion:
        return _sesion_pendiente(conexion, cliente, hoy_negocio().isoformat()) is not None


def confirmaciones_de_hoy(cliente: str, ruta: Path = RUTA_POR_DEFECTO) -> list[dict]:
    """Todas las confirmaciones que el cliente ha hecho hoy (puede haber
    más de una si Fernando le firmó varias sesiones el mismo día), de la
    más reciente a la más antigua."""
    with conectar(ruta) as conexion:
        filas = conexion.execute(
            "SELECT fecha, hora FROM firmas_publicas WHERE cliente = ? AND fecha = ? ORDER BY id DESC",
            (cliente, hoy_negocio().isoformat()),
        ).fetchall()
    return [dict(fila) for fila in filas]


def confirmar_sesion_publica(cliente: str, ruta: Path = RUTA_POR_DEFECTO) -> dict:
    """El cliente confirma su sesión de HOY pendiente más reciente. No crea
    ni modifica ninguna sesión del historial, ni toca el bono ni la
    economía — solo dice "esto está bien", asociado a esa sesión concreta.
    Lanza `ValueError` si no hay ninguna sesión pendiente de confirmar
    (Fernando no ha firmado nada hoy todavía, o ya está todo confirmado)."""
    ahora = ahora_negocio()
    hoy = ahora.date().isoformat()
    with conectar(ruta) as conexion:
        pendiente = _sesion_pendiente(conexion, cliente, hoy)
        if pendiente is None:
            raise ValueError("No tienes ninguna sesión pendiente de confirmar")
        conexion.execute(
            "INSERT INTO firmas_publicas (cliente, fecha, hora, sesion_id) VALUES (?, ?, ?, ?)",
            (cliente, hoy, ahora.strftime("%H:%M"), pendiente["id"]),
        )

    registrar_aviso(
        hoy,
        "confirmacion_cliente",
        f"'{cliente}' ha confirmado su sesión de hoy desde su enlace personal",
        ruta,
    )

    return {"fecha": hoy, "hora": ahora.strftime("%H:%M")}


def avisar_confirmaciones_pendientes(ruta: Path = RUTA_POR_DEFECTO) -> None:
    """Revisa desde `FECHA_INICIO_CONFIRMACIONES` hasta ayer (nunca hoy,
    para no avisar antes de que el cliente haya tenido ocasión de
    confirmar) y deja un aviso por cada sesión concreta que Fernando firmó
    y el cliente nunca confirmó desde su enlace — sesión a sesión, así que
    si un día tuvo dos sesiones y solo confirmó una, la otra avisa igual.

    Pensada para llamarse en las páginas que Fernando abre de forma
    habitual (portada, avisos) — no hay una tarea programada detrás; el
    aviso aparece la próxima vez que entra a la web, como el resto de
    avisos del sistema."""
    hoy = hoy_negocio()
    desde = FECHA_INICIO_CONFIRMACIONES.isoformat()

    # Una única conexión para consultar Y registrar. Antes se abría una
    # conexión nueva por cada aviso, y esto corre en CADA carga de la
    # portada: con varias sesiones sin confirmar, eran varias aperturas de
    # base de datos por visita (2026-08-01, revisando la lentitud).
    with conectar(ruta) as conexion:
        pendientes = conexion.execute(
            "SELECT h.cliente, h.fecha, h.numero_sesion FROM historial_sesiones h "
            "WHERE h.fecha >= ? AND h.fecha < ? "
            "AND h.id NOT IN (SELECT sesion_id FROM firmas_publicas WHERE sesion_id IS NOT NULL)",
            (desde, hoy.isoformat()),
        ).fetchall()

        for fila in pendientes:
            registrar_aviso(
                fila["fecha"],
                "confirmacion_pendiente",
                f"'{fila['cliente']}' no confirmó la sesión {fila['numero_sesion']} del {fila['fecha']} desde su enlace personal",
                ruta,
                conexion=conexion,
            )
