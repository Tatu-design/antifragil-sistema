"""Conexión y esquema compartidos de la base de datos del sistema real
(`datos/antifragil.db`, SQLite).

Sustituye a los archivos Excel (`datos/clientes.xlsx`, `datos/facturacion.xlsx`)
como fuente de verdad — decisión de Fernando del 2026-07-17/18 (ver
docs/ARQUITECTURA.md): quería poder alojar el sistema en internet más
adelante, y la mayoría de alojamientos no garantizan que un archivo Excel
sobreviva a un reinicio; además es la base real para lo que se aprende en
el proyecto de la web app (`webapp/`).

`clientes/repositorio.py` y `economia/registro.py` usan este módulo para
conectarse; cada uno gestiona sus propias tablas.
"""

import sqlite3
from pathlib import Path

RUTA_POR_DEFECTO = Path(__file__).resolve().parent / "datos" / "antifragil.db"


def conectar(ruta: Path = RUTA_POR_DEFECTO) -> sqlite3.Connection:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    conexion = sqlite3.connect(ruta)
    conexion.row_factory = sqlite3.Row  # permite leer columnas por nombre, como un diccionario
    conexion.execute("PRAGMA foreign_keys = ON")
    return conexion


def crear_esquema(ruta: Path = RUTA_POR_DEFECTO) -> None:
    """Crea todas las tablas si no existen todavía. Segura de repetir — no
    borra datos existentes."""
    with conectar(ruta) as conexion:
        conexion.execute(
            """
            CREATE TABLE IF NOT EXISTS programas (
                nombre TEXT PRIMARY KEY,
                tarifa REAL NOT NULL,
                sesiones_totales INTEGER NOT NULL
            )
            """
        )
        conexion.execute(
            """
            CREATE TABLE IF NOT EXISTS clientes (
                nombre TEXT PRIMARY KEY,
                tipo_programa TEXT NOT NULL REFERENCES programas(nombre),
                sesiones_completadas INTEGER NOT NULL DEFAULT 0,
                pendiente_pago INTEGER NOT NULL DEFAULT 0
            )
            """
        )
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
