"""Confirmación pública de sesión desde el enlace personal del cliente
(`/mi/<token>`) — decisión de Fernando, 2026-07-29.

Primer diseño (mismo día): el cliente podía firmar su propia sesión desde
su enlace, creando una entrada nueva en su historial. Se detectó un riesgo
real antes de desplegarlo del todo: si Fernando ya había firmado la sesión
de ese cliente desde su perfil, y el cliente también confirmaba desde el
suyo, se contaban dos sesiones por un solo entrenamiento — el mismo tipo
de descuadre que el sprint de integridad del día anterior arregló para
Felipe y Javi.

Diseño definitivo (más simple y sin ese riesgo): el cliente nunca crea
nada. Fernando sigue firmando la sesión exactamente igual que siempre
(`registrar_sesion_pt`, sin cambios). El cliente solo puede **confirmar**
que la sesión que Fernando ya registró hoy es correcta — una anotación
aparte (tabla `firmas_publicas`) que no toca el bono, el historial ni la
economía en absoluto. Si Fernando firmó pero el cliente nunca confirmó,
se lo decimos con un aviso — no en el momento (no hay forma fiable de
avisar en tiempo real, ver lección de la actualización diaria de
Calendar), sino la próxima vez que Fernando abra la web, igual que
funciona el resto de avisos."""

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


def hay_sesion_hoy(cliente: str, ruta: Path = RUTA_POR_DEFECTO) -> bool:
    """True si Fernando ya ha firmado una sesión de este cliente hoy —
    condición para que tenga sentido ofrecerle el botón de confirmar."""
    with conectar(ruta) as conexion:
        fila = conexion.execute(
            "SELECT 1 FROM historial_sesiones WHERE cliente = ? AND fecha = ? LIMIT 1",
            (cliente, hoy_negocio().isoformat()),
        ).fetchone()
    return fila is not None


def confirmacion_de_hoy(cliente: str, ruta: Path = RUTA_POR_DEFECTO) -> dict | None:
    """La confirmación que el propio cliente ha hecho hoy sobre su sesión,
    si la hay (fecha + hora) — para mostrar el recibo."""
    with conectar(ruta) as conexion:
        fila = conexion.execute(
            "SELECT fecha, hora FROM firmas_publicas WHERE cliente = ? AND fecha = ? ORDER BY id DESC LIMIT 1",
            (cliente, hoy_negocio().isoformat()),
        ).fetchone()
    return dict(fila) if fila else None


def confirmar_sesion_publica(cliente: str, ruta: Path = RUTA_POR_DEFECTO) -> dict:
    """El cliente confirma su sesión de HOY. No crea ni modifica ninguna
    sesión del historial, ni toca el bono ni la economía — solo dice "esto
    está bien". Lanza `ValueError` si no hay nada que confirmar (Fernando
    no ha firmado nada hoy todavía) o si ya se había confirmado."""
    if not hay_sesion_hoy(cliente, ruta):
        raise ValueError("Todavía no tienes ninguna sesión firmada hoy")
    if confirmacion_de_hoy(cliente, ruta) is not None:
        raise ValueError("Ya has confirmado tu sesión de hoy")

    ahora = ahora_negocio()
    with conectar(ruta) as conexion:
        conexion.execute(
            "INSERT INTO firmas_publicas (cliente, fecha, hora) VALUES (?, ?, ?)",
            (cliente, ahora.date().isoformat(), ahora.strftime("%H:%M")),
        )

    registrar_aviso(
        ahora.date().isoformat(),
        "confirmacion_cliente",
        f"'{cliente}' ha confirmado su sesión de hoy desde su enlace personal",
        ruta,
    )

    return {"fecha": ahora.date().isoformat(), "hora": ahora.strftime("%H:%M")}


def avisar_confirmaciones_pendientes(ruta: Path = RUTA_POR_DEFECTO) -> None:
    """Revisa desde `FECHA_INICIO_CONFIRMACIONES` hasta ayer (nunca hoy,
    para no avisar antes de que el cliente haya tenido ocasión de
    confirmar) y deja un aviso por cada sesión que Fernando firmó y el
    cliente nunca confirmó desde su enlace.

    Pensada para llamarse en las páginas que Fernando abre de forma
    habitual (portada, avisos) — no hay una tarea programada detrás; el
    aviso aparece la próxima vez que entra a la web, como el resto de
    avisos del sistema."""
    hoy = hoy_negocio()
    desde = FECHA_INICIO_CONFIRMACIONES.isoformat()
    with conectar(ruta) as conexion:
        pendientes = conexion.execute(
            "SELECT DISTINCT h.cliente, h.fecha FROM historial_sesiones h "
            "WHERE h.fecha >= ? AND h.fecha < ? "
            "AND NOT EXISTS ("
            "  SELECT 1 FROM firmas_publicas f WHERE f.cliente = h.cliente AND f.fecha = h.fecha"
            ")",
            (desde, hoy.isoformat()),
        ).fetchall()

    for fila in pendientes:
        registrar_aviso(
            fila["fecha"],
            "confirmacion_pendiente",
            f"'{fila['cliente']}' no confirmó su sesión del {fila['fecha']} desde su enlace personal",
            ruta,
        )
