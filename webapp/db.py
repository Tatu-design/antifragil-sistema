"""Acceso a datos de la web app usando SQLite.

Sustituye a `clientes/repositorio.py` (que sigue existiendo, intacto, para
el sistema real del negocio basado en Excel — cierre semanal, economía).
Este módulo es solo para la web app del proyecto de aprendizaje.

Concepto clave: una base de datos SQL tiene "tablas" (como pestañas de
Excel, pero con un tipo de dato fijo por columna) y se consulta con SQL, un
lenguaje para pedir y guardar datos. `sqlite3` viene incluido en Python —
no hace falta instalar nada, y toda la base de datos es un único archivo
(`datos/webapp.db`), igual de simple de mover/hacer copia de seguridad que
el Excel.

Dos tablas:
- `programas`: el equivalente a la hoja "Programas" del Excel (nombre,
  tarifa, sesiones totales).
- `clientes`: nombre, qué programa tiene, sesiones completadas y si está
  pendiente de pago. La tarifa/sesiones totales no se repiten aquí — se
  obtienen uniendo ("JOIN") con `programas` por el nombre del programa,
  igual que hacía el VLOOKUP en Excel.
"""

import sqlite3
from pathlib import Path

RUTA_POR_DEFECTO = Path(__file__).resolve().parent.parent / "datos" / "webapp.db"


def _conectar(ruta: Path = RUTA_POR_DEFECTO) -> sqlite3.Connection:
    conexion = sqlite3.connect(ruta)
    conexion.row_factory = sqlite3.Row  # permite leer columnas por nombre, como un diccionario
    conexion.execute("PRAGMA foreign_keys = ON")
    return conexion


def crear_esquema(ruta: Path = RUTA_POR_DEFECTO) -> None:
    """Crea las tablas si no existen todavía. Se puede llamar siempre sin
    riesgo — no borra datos si ya existen."""
    ruta.parent.mkdir(parents=True, exist_ok=True)
    with _conectar(ruta) as conexion:
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


def guardar_programa(nombre: str, tarifa: float, sesiones_totales: int, ruta: Path = RUTA_POR_DEFECTO) -> None:
    """Da de alta o actualiza un programa (usado por la migración inicial)."""
    with _conectar(ruta) as conexion:
        conexion.execute(
            "INSERT INTO programas (nombre, tarifa, sesiones_totales) VALUES (?, ?, ?) "
            "ON CONFLICT(nombre) DO UPDATE SET tarifa = excluded.tarifa, sesiones_totales = excluded.sesiones_totales",
            (nombre, tarifa, sesiones_totales),
        )


def listar_tipos_programa(ruta: Path = RUTA_POR_DEFECTO) -> list[str]:
    with _conectar(ruta) as conexion:
        filas = conexion.execute("SELECT nombre FROM programas ORDER BY nombre").fetchall()
    return [fila["nombre"] for fila in filas]


def leer_clientes(ruta: Path = RUTA_POR_DEFECTO) -> dict[str, dict]:
    """Devuelve {cliente: {tipo_programa, tarifa, sesiones_totales,
    sesiones_completadas, pendiente_pago}} — misma forma que
    `clientes.repositorio.leer_clientes()`, para que el resto de la web app
    no tenga que cambiar."""
    with _conectar(ruta) as conexion:
        filas = conexion.execute(
            """
            SELECT c.nombre, c.tipo_programa, p.tarifa, p.sesiones_totales,
                   c.sesiones_completadas, c.pendiente_pago
            FROM clientes c
            JOIN programas p ON p.nombre = c.tipo_programa
            ORDER BY c.nombre
            """
        ).fetchall()

    return {
        fila["nombre"]: {
            "tipo_programa": fila["tipo_programa"],
            "tarifa": fila["tarifa"],
            "sesiones_totales": fila["sesiones_totales"],
            "sesiones_completadas": fila["sesiones_completadas"],
            "pendiente_pago": "Sí" if fila["pendiente_pago"] else "No",
        }
        for fila in filas
    }


def crear_cliente(
    nombre: str, tipo_programa: str, sesiones_completadas: int, pendiente_pago: bool, ruta: Path = RUTA_POR_DEFECTO
) -> None:
    nombre = nombre.strip()
    if not nombre:
        raise ValueError("El nombre del cliente no puede estar vacío")

    with _conectar(ruta) as conexion:
        existe = conexion.execute("SELECT 1 FROM clientes WHERE nombre = ?", (nombre,)).fetchone()
        if existe:
            raise ValueError(f"Ya existe un cliente llamado '{nombre}'")
        conexion.execute(
            "INSERT INTO clientes (nombre, tipo_programa, sesiones_completadas, pendiente_pago) "
            "VALUES (?, ?, ?, ?)",
            (nombre, tipo_programa, sesiones_completadas, int(pendiente_pago)),
        )


def actualizar_cliente(
    nombre: str,
    nuevo_nombre: str,
    tipo_programa: str,
    sesiones_completadas: int,
    pendiente_pago: bool,
    ruta: Path = RUTA_POR_DEFECTO,
) -> None:
    nuevo_nombre = nuevo_nombre.strip()
    if not nuevo_nombre:
        raise ValueError("El nombre del cliente no puede estar vacío")

    with _conectar(ruta) as conexion:
        existe = conexion.execute("SELECT 1 FROM clientes WHERE nombre = ?", (nombre,)).fetchone()
        if not existe:
            raise ValueError(f"No existe el cliente '{nombre}'")
        if nuevo_nombre != nombre:
            colision = conexion.execute("SELECT 1 FROM clientes WHERE nombre = ?", (nuevo_nombre,)).fetchone()
            if colision:
                raise ValueError(f"Ya existe un cliente llamado '{nuevo_nombre}'")
        conexion.execute(
            "UPDATE clientes SET nombre = ?, tipo_programa = ?, sesiones_completadas = ?, pendiente_pago = ? "
            "WHERE nombre = ?",
            (nuevo_nombre, tipo_programa, sesiones_completadas, int(pendiente_pago), nombre),
        )
