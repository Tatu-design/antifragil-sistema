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
from contextlib import contextmanager
from pathlib import Path

RUTA_POR_DEFECTO = Path(__file__).resolve().parent / "datos" / "antifragil.db"


def conectar(ruta: Path = RUTA_POR_DEFECTO) -> sqlite3.Connection:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    conexion = sqlite3.connect(ruta)
    conexion.row_factory = sqlite3.Row  # permite leer columnas por nombre, como un diccionario
    conexion.execute("PRAGMA foreign_keys = ON")
    # WAL en vez del modo por defecto: cada guardado no tiene que reescribir
    # ni sincronizar en disco un archivo de "journal" entero, solo anotar el
    # cambio aparte, y las lecturas ya no esperan a que termine una
    # escritura en curso — notablemente más rápido para una web que abre
    # muchas conexiones cortas por petición (decisión de Fernando del
    # 2026-07-24, tras notar la web lenta al firmar sesiones).
    #
    # `wal_autocheckpoint = 1` obliga a volcar ese cambio al archivo
    # principal (antifragil.db) en cuanto se guarda, en vez de dejarlo un
    # rato aparte en antifragil.db-wal — así el archivo que se descarga o
    # sincroniza con el servidor (`sincronizar_servidor.py`, y cualquier
    # copia de diagnóstico) sigue siendo siempre ese único archivo completo,
    # sin tener que acordarse de mover también un archivo -wal aparte.
    conexion.execute("PRAGMA journal_mode = WAL")
    conexion.execute("PRAGMA wal_autocheckpoint = 1")
    return conexion


@contextmanager
def transaccion(ruta: Path = RUTA_POR_DEFECTO):
    """Agrupa varios pasos de una operación de negocio (firmar sesión,
    editar, borrar, clase de grupo) en una única transacción atómica: si
    cualquier paso falla, no queda guardado ninguno (sprint de integridad,
    2026-07-28 — antes, firmar una sesión hacía 3-4 guardados
    independientes; un fallo a mitad podía dejar el bono actualizado pero
    la economía no, o viceversa).

    Los repositorios que reciben un parámetro `conexion` reutilizan esta
    misma conexión en vez de abrir la suya propia — así todo el bloque
    vive dentro de la misma transacción SQLite."""
    conexion = conectar(ruta)
    try:
        yield conexion
        conexion.commit()
    except Exception:
        conexion.rollback()
        raise
    finally:
        conexion.close()


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
                pendiente_pago INTEGER NOT NULL DEFAULT 0,
                token TEXT,
                ciclo_bono INTEGER NOT NULL DEFAULT 1
            )
            """
        )
        conexion.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_token ON clientes(token)")
        columnas_clientes = {fila["name"] for fila in conexion.execute("PRAGMA table_info(clientes)")}
        if "ciclo_bono" not in columnas_clientes:
            conexion.execute("ALTER TABLE clientes ADD COLUMN ciclo_bono INTEGER NOT NULL DEFAULT 1")
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
        conexion.execute(
            """
            CREATE TABLE IF NOT EXISTS configuracion (
                clave TEXT PRIMARY KEY,
                valor TEXT NOT NULL
            )
            """
        )
        conexion.execute(
            """
            CREATE TABLE IF NOT EXISTS avisos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fecha TEXT NOT NULL,
                tipo TEXT NOT NULL,
                detalle TEXT NOT NULL,
                resuelto INTEGER NOT NULL DEFAULT 0,
                leido INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conexion.execute(
            """
            CREATE TABLE IF NOT EXISTS historial_sesiones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente TEXT NOT NULL REFERENCES clientes(nombre),
                fecha TEXT NOT NULL,
                tipo_programa TEXT NOT NULL,
                numero_sesion INTEGER NOT NULL,
                sesiones_totales INTEGER NOT NULL,
                tarifa REAL,
                ciclo_bono INTEGER NOT NULL DEFAULT 1
            )
            """
        )
        columnas = {fila["name"] for fila in conexion.execute("PRAGMA table_info(historial_sesiones)")}
        if "tarifa" not in columnas:
            conexion.execute("ALTER TABLE historial_sesiones ADD COLUMN tarifa REAL")
        if "ciclo_bono" not in columnas:
            # Sprint de integridad 2026-07-28: sin esto, el historial no
            # distingue a qué bono (antes o después de una renovación)
            # pertenece cada sesión — borrar la primera sesión de un bono
            # nuevo podía hacer que el contador "completadas" volviera a
            # mostrar el número del bono ANTERIOR (bug confirmado y
            # reproducido). Los datos ya existentes se marcan todos como
            # ciclo 1 (no hay forma de reconstruir los cortes de ciclo
            # pasados sin esta columna) — las sesiones nuevas sí llevan el
            # ciclo correcto desde ahora.
            conexion.execute("ALTER TABLE historial_sesiones ADD COLUMN ciclo_bono INTEGER NOT NULL DEFAULT 1")

        # Migración 2026-07-24: hasta ahora un cliente solo podía tener una
        # sesión de PT por día (UNIQUE(cliente, fecha)) — Fernando pidió
        # poder firmar más de una si hace falta (p. ej. una sesión extra de
        # regalo, o dos sesiones reales el mismo día). SQLite no permite
        # quitar un UNIQUE con ALTER TABLE, así que se reconstruye la tabla
        # sin él, conservando todos los datos y los mismos `id`. Cada
        # sesión pasa a identificarse por su `id`, no por (cliente, fecha).
        definicion = conexion.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='historial_sesiones'"
        ).fetchone()["sql"]
        if "UNIQUE" in definicion:
            conexion.execute(
                """
                CREATE TABLE historial_sesiones_nueva (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    cliente TEXT NOT NULL REFERENCES clientes(nombre),
                    fecha TEXT NOT NULL,
                    tipo_programa TEXT NOT NULL,
                    numero_sesion INTEGER NOT NULL,
                    sesiones_totales INTEGER NOT NULL,
                    tarifa REAL
                )
                """
            )
            conexion.execute(
                "INSERT INTO historial_sesiones_nueva "
                "(id, cliente, fecha, tipo_programa, numero_sesion, sesiones_totales, tarifa) "
                "SELECT id, cliente, fecha, tipo_programa, numero_sesion, sesiones_totales, tarifa "
                "FROM historial_sesiones"
            )
            conexion.execute("DROP TABLE historial_sesiones")
            conexion.execute("ALTER TABLE historial_sesiones_nueva RENAME TO historial_sesiones")
        conexion.execute(
            """
            CREATE TABLE IF NOT EXISTS clases_grupo (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fecha TEXT NOT NULL,
                tipo TEXT NOT NULL
            )
            """
        )
        conexion.execute(
            """
            CREATE TABLE IF NOT EXISTS facturacion_kids_mensual (
                anio INTEGER NOT NULL,
                mes INTEGER NOT NULL,
                importe REAL NOT NULL,
                PRIMARY KEY (anio, mes)
            )
            """
        )
        conexion.execute(
            """
            CREATE TABLE IF NOT EXISTS firmas_idempotencia (
                clave TEXT PRIMARY KEY,
                creado TEXT NOT NULL
            )
            """
        )
        conexion.execute(
            """
            CREATE TABLE IF NOT EXISTS firmas_publicas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente TEXT NOT NULL REFERENCES clientes(nombre),
                fecha TEXT NOT NULL,
                hora TEXT NOT NULL
            )
            """
        )
