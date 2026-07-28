"""Avisos para que Fernando revise cuando le venga bien cosas que la
actualización diaria automática no ha podido procesar sola (una sesión con
un título que no reconoce, un cliente sin programa asignado...).

No bloquean nada — la actualización diaria sigue guardando lo que sí sabe
procesar, y deja aquí constancia de lo que no, para revisar después (ver
decisión de Fernando del 2026-07-21: quiere la actualización diaria sin
confirmar cada vez, con avisos a posteriori en vez de antes de guardar)."""

from pathlib import Path

from basedatos import RUTA_POR_DEFECTO, conectar


def registrar_aviso(fecha: str, tipo: str, detalle: str, ruta: Path = RUTA_POR_DEFECTO) -> None:
    """No duplica: si ya hay un aviso sin resolver con el mismo tipo y
    texto, no crea uno nuevo. Sin esto, algo que se comprueba en cada
    firma (como la sincronización con la economía) crea un aviso repetido
    por cada sesión que se firma esa semana, aunque sea siempre el mismo
    hueco ya conocido — encontrado el 2026-07-24, cuando el aviso del hueco
    de Nikki se repitió varias veces seguidas."""
    with conectar(ruta) as conexion:
        ya_existe = conexion.execute(
            "SELECT 1 FROM avisos WHERE resuelto = 0 AND tipo = ? AND detalle = ? LIMIT 1",
            (tipo, detalle),
        ).fetchone()
        if ya_existe:
            return
        conexion.execute(
            "INSERT INTO avisos (fecha, tipo, detalle) VALUES (?, ?, ?)",
            (fecha, tipo, detalle),
        )


def listar_avisos_pendientes(ruta: Path = RUTA_POR_DEFECTO) -> list[dict]:
    """Los no resueltos, más recientes primero, con los nuevos (no leídos)
    por delante de los ya vistos."""
    with conectar(ruta) as conexion:
        filas = conexion.execute(
            "SELECT id, fecha, tipo, detalle, leido FROM avisos WHERE resuelto = 0 "
            "ORDER BY leido ASC, fecha DESC, id DESC"
        ).fetchall()
    return [dict(fila) for fila in filas]


def contar_no_leidos(ruta: Path = RUTA_POR_DEFECTO) -> int:
    if not ruta.exists():
        return 0
    with conectar(ruta) as conexion:
        fila = conexion.execute(
            "SELECT COUNT(*) AS n FROM avisos WHERE resuelto = 0 AND leido = 0"
        ).fetchone()
    return fila["n"]


def marcar_todos_leidos(ruta: Path = RUTA_POR_DEFECTO) -> None:
    with conectar(ruta) as conexion:
        conexion.execute("UPDATE avisos SET leido = 1 WHERE resuelto = 0 AND leido = 0")


def resolver_aviso(aviso_id: int, ruta: Path = RUTA_POR_DEFECTO) -> None:
    with conectar(ruta) as conexion:
        conexion.execute("UPDATE avisos SET resuelto = 1 WHERE id = ?", (aviso_id,))
