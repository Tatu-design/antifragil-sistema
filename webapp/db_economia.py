"""Registro económico (facturación semanal/mensual) en SQLite.

Equivalente en SQLite a `economia/registro.py` (que sigue intacto, usando
Excel, para el sistema real — ver decisión del 2026-07-17 en
docs/APRENDIZAJE_WEBAPP.md: la migración completa del negocio real se hace
después del primer cierre semanal real, no antes).

Dos tablas:
- `semanas`: una fila por semana cerrada.
- `desglose`: una fila por (semana, tarifa) — el detalle por tarifa.

A diferencia de la versión en Excel, aquí **no hace falta guardar aparte
los totales del mes**: con SQL se pueden sumar las semanas de un mes al
vuelo (`SUM(...) GROUP BY`) cada vez que se preguntan, así que no hay un
"total guardado" que se pueda quedar desactualizado.
"""

import sqlite3
from pathlib import Path

from webapp.db import RUTA_POR_DEFECTO, _conectar

# Tarifa fija de CrossFit Lidomare — ver docs/TARIFAS.md.
TARIFA_CROSSFIT_LIDOMARE = 15.0


def crear_esquema(ruta: Path = RUTA_POR_DEFECTO) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    with _conectar(ruta) as conexion:
        conexion.execute(
            """
            CREATE TABLE IF NOT EXISTS semanas (
                fecha_inicio TEXT PRIMARY KEY,
                fecha_fin TEXT NOT NULL,
                anio INTEGER NOT NULL,
                mes INTEGER NOT NULL,
                facturacion_pt_lidomare REAL NOT NULL,
                horas_pt_lidomare INTEGER NOT NULL,
                sesiones_kids INTEGER NOT NULL DEFAULT 0,
                facturacion_kids REAL
            )
            """
        )
        conexion.execute(
            """
            CREATE TABLE IF NOT EXISTS desglose (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fecha_inicio_semana TEXT NOT NULL REFERENCES semanas(fecha_inicio),
                tarifa REAL NOT NULL,
                sesiones INTEGER NOT NULL,
                facturacion REAL NOT NULL
            )
            """
        )


def registrar_semana(
    fecha_inicio: str,
    fecha_fin: str,
    desglose: dict[float, dict],
    sesiones_kids: int,
    ruta: Path = RUTA_POR_DEFECTO,
) -> None:
    """desglose: {tarifa: {"sesiones": n, "facturacion": importe}} — mismo
    formato que devuelve `economia.calculo.calcular_desglose`."""
    anio, mes = int(fecha_inicio[:4]), int(fecha_inicio[5:7])
    facturacion_pt_lidomare = sum(d["facturacion"] for d in desglose.values())
    horas_pt_lidomare = sum(d["sesiones"] for d in desglose.values())

    with _conectar(ruta) as conexion:
        existente = conexion.execute(
            "SELECT facturacion_kids FROM semanas WHERE fecha_inicio = ?", (fecha_inicio,)
        ).fetchone()
        facturacion_kids_previa = existente["facturacion_kids"] if existente else None

        conexion.execute(
            """
            INSERT INTO semanas
                (fecha_inicio, fecha_fin, anio, mes, facturacion_pt_lidomare, horas_pt_lidomare, sesiones_kids, facturacion_kids)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(fecha_inicio) DO UPDATE SET
                fecha_fin = excluded.fecha_fin,
                facturacion_pt_lidomare = excluded.facturacion_pt_lidomare,
                horas_pt_lidomare = excluded.horas_pt_lidomare,
                sesiones_kids = excluded.sesiones_kids
            """,
            (fecha_inicio, fecha_fin, anio, mes, facturacion_pt_lidomare, horas_pt_lidomare, sesiones_kids, facturacion_kids_previa),
        )

        conexion.execute("DELETE FROM desglose WHERE fecha_inicio_semana = ?", (fecha_inicio,))
        for tarifa, datos in desglose.items():
            conexion.execute(
                "INSERT INTO desglose (fecha_inicio_semana, tarifa, sesiones, facturacion) VALUES (?, ?, ?, ?)",
                (fecha_inicio, tarifa, datos["sesiones"], datos["facturacion"]),
            )


def registrar_facturacion_kids(anio: int, mes: int, facturacion_total_kids: float, ruta: Path = RUTA_POR_DEFECTO) -> float:
    """Reparte la facturación mensual de CrossFit Kids entre las semanas de
    ese mes, proporcionalmente a las sesiones de cada semana. Devuelve el
    precio por sesión."""
    with _conectar(ruta) as conexion:
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


def obtener_semana(fecha_inicio: str, ruta: Path = RUTA_POR_DEFECTO) -> dict | None:
    if not ruta.exists():
        return None
    with _conectar(ruta) as conexion:
        fila = conexion.execute("SELECT * FROM semanas WHERE fecha_inicio = ?", (fecha_inicio,)).fetchone()
    return _fila_semana_a_dict(fila) if fila else None


def obtener_mes(anio: int, mes: int, ruta: Path = RUTA_POR_DEFECTO) -> dict | None:
    if not ruta.exists():
        return None
    with _conectar(ruta) as conexion:
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
