"""Registro histórico de facturación, consultable por semana o por mes en
cualquier momento.

Desde el 2026-07-18, esto es SQLite (`datos/antifragil.db`, ver
`basedatos.py`) — antes era un Excel. Se mantienen las mismas funciones
públicas que ya usaban `cierre_semanal/` y `economia/cli.py`.

Dos tablas:
- `semanas`: una fila por semana cerrada.
- `desglose`: una fila por (semana, tarifa) — el detalle por tarifa que
  antes llevaba Fernando a mano en su propia hoja de cálculo.

A diferencia de la versión en Excel, **no hace falta guardar aparte los
totales del mes**: con SQL se suman las semanas de un mes al vuelo
(`SUM(...) GROUP BY`) cada vez que se preguntan, así que no hay un total
guardado que se pueda quedar desactualizado.

CrossFit Kids se registra sin facturación hasta que Fernando indica el
importe mensual (`registrar_facturacion_kids`), momento en el que se
reparte hacia atrás sobre las semanas de ese mes (importe ÷ sesiones del
mes = precio por sesión; cada semana se multiplica por sus sesiones).
"""

import sqlite3
from datetime import date
from pathlib import Path

from basedatos import RUTA_POR_DEFECTO, conectar
from economia.calculo import resumir


def registrar_semana(
    fecha_inicio: date,
    fecha_fin: date,
    desglose: dict[float, dict],
    sesiones_kids: int,
    ruta: Path = RUTA_POR_DEFECTO,
) -> None:
    """Guarda (o actualiza, si ya existía) el resultado económico de una
    semana. `desglose`: {tarifa: {"sesiones": n, "facturacion": importe}}
    — formato que devuelve `economia.calculo.calcular_desglose`."""
    resumen = resumir(desglose)
    anio, mes = fecha_inicio.year, fecha_inicio.month
    clave = fecha_inicio.isoformat()

    with conectar(ruta) as conexion:
        conexion.execute(
            """
            INSERT INTO semanas
                (fecha_inicio, fecha_fin, anio, mes, facturacion_pt_lidomare, horas_pt_lidomare, sesiones_kids)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(fecha_inicio) DO UPDATE SET
                fecha_fin = excluded.fecha_fin,
                facturacion_pt_lidomare = excluded.facturacion_pt_lidomare,
                horas_pt_lidomare = excluded.horas_pt_lidomare,
                sesiones_kids = excluded.sesiones_kids
            """,
            (clave, fecha_fin.isoformat(), anio, mes, resumen["facturacion_total"], resumen["horas_totales"], sesiones_kids),
        )

        conexion.execute("DELETE FROM desglose WHERE fecha_inicio_semana = ?", (clave,))
        for tarifa, datos in desglose.items():
            conexion.execute(
                "INSERT INTO desglose (fecha_inicio_semana, tarifa, sesiones, facturacion) VALUES (?, ?, ?, ?)",
                (clave, tarifa, datos["sesiones"], datos["facturacion"]),
            )


def registrar_facturacion_kids(anio: int, mes: int, facturacion_total_kids: float, ruta: Path = RUTA_POR_DEFECTO) -> float:
    """Reparte la facturación mensual de CrossFit Kids entre las semanas de
    ese mes, proporcionalmente a las sesiones de cada semana. Devuelve el
    precio por sesión."""
    with conectar(ruta) as conexion:
        sesiones_kids_mes = conexion.execute(
            "SELECT COALESCE(SUM(sesiones_kids), 0) AS total FROM semanas WHERE anio = ? AND mes = ?", (anio, mes)
        ).fetchone()["total"]

        if not sesiones_kids_mes:
            raise ValueError(f"No hay sesiones de CrossFit Kids registradas para {mes}/{anio}.")

        precio_sesion = facturacion_total_kids / sesiones_kids_mes

        conexion.execute(
            "UPDATE semanas SET facturacion_kids = sesiones_kids * ? WHERE anio = ? AND mes = ?",
            (precio_sesion, anio, mes),
        )

    return precio_sesion


def _fila_semana_a_dict(fila: sqlite3.Row) -> dict:
    facturacion_kids = fila["facturacion_kids"] or 0
    horas_totales = fila["horas_pt_lidomare"] + fila["sesiones_kids"]
    facturacion_total = fila["facturacion_pt_lidomare"] + facturacion_kids
    return {
        "fecha_inicio": fila["fecha_inicio"],
        "fecha_fin": fila["fecha_fin"],
        "sesiones_kids": fila["sesiones_kids"],
        "facturacion_kids": fila["facturacion_kids"],
        "facturacion_total": facturacion_total,
        "horas_totales": horas_totales,
        "precio_medio_hora": facturacion_total / horas_totales if horas_totales else 0.0,
    }


def obtener_semana(fecha_inicio_iso: str, ruta: Path = RUTA_POR_DEFECTO) -> dict | None:
    if not ruta.exists():
        return None
    with conectar(ruta) as conexion:
        fila = conexion.execute("SELECT * FROM semanas WHERE fecha_inicio = ?", (fecha_inicio_iso,)).fetchone()
    return _fila_semana_a_dict(fila) if fila else None


def obtener_mes(anio: int, mes: int, ruta: Path = RUTA_POR_DEFECTO) -> dict | None:
    if not ruta.exists():
        return None
    with conectar(ruta) as conexion:
        fila = conexion.execute(
            """
            SELECT
                COALESCE(SUM(facturacion_pt_lidomare), 0) AS facturacion_pt_lidomare,
                COALESCE(SUM(horas_pt_lidomare), 0) AS horas_pt_lidomare,
                COALESCE(SUM(sesiones_kids), 0) AS sesiones_kids,
                SUM(facturacion_kids) AS facturacion_kids,
                COUNT(*) AS num_semanas
            FROM semanas WHERE anio = ? AND mes = ?
            """,
            (anio, mes),
        ).fetchone()

    if not fila or not fila["num_semanas"]:
        return None

    facturacion_kids = fila["facturacion_kids"] or 0
    horas_totales = fila["horas_pt_lidomare"] + fila["sesiones_kids"]
    facturacion_total = fila["facturacion_pt_lidomare"] + facturacion_kids
    return {
        "facturacion_total": facturacion_total,
        "horas_totales": horas_totales,
        "precio_medio_hora": facturacion_total / horas_totales if horas_totales else 0.0,
        "sesiones_kids": fila["sesiones_kids"],
        "facturacion_kids": fila["facturacion_kids"],
    }
