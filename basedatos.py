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
    # `journal_mode` y `wal_autocheckpoint` NO se ponen aquí: son
    # propiedades que quedan grabadas en la propia base de datos, así que
    # basta configurarlas una vez (`crear_esquema`). Repetirlas en cada
    # conexión obligaba a tocar la cabecera del archivo y pedir bloqueos en
    # cada una de las 4-5 conexiones que abre una página — trabajo inútil
    # que se nota en un disco compartido como el del servidor (2026-08-01).
    return conexion


@contextmanager
def transaccion(ruta: Path = RUTA_POR_DEFECTO, inmediata: bool = False):
    """Agrupa varios pasos de una operación de negocio (firmar sesión,
    editar, borrar, clase de grupo) en una única transacción atómica: si
    cualquier paso falla, no queda guardado ninguno (sprint de integridad,
    2026-07-28 — antes, firmar una sesión hacía 3-4 guardados
    independientes; un fallo a mitad podía dejar el bono actualizado pero
    la economía no, o viceversa).

    Los repositorios que reciben un parámetro `conexion` reutilizan esta
    misma conexión en vez de abrir la suya propia — así todo el bloque
    vive dentro de la misma transacción SQLite.

    `inmediata=True` abre la transacción con `BEGIN IMMEDIATE`: coge el
    bloqueo de escritura ANTES de la primera lectura, en vez de esperar a
    la primera escritura. Es lo que hace falta cuando la operación LEE un
    estado y DECIDE a partir de él (p. ej. "¿cuál es la siguiente sesión de
    este bono?"): sin esto, dos firmas simultáneas del mismo cliente pueden
    leer las dos el mismo estado y calcular las dos el mismo número de
    sesión (segunda auditoría, 2026-07-30). No penaliza las lecturas
    normales — en modo WAL los lectores siguen sin bloquearse; solo se
    serializan entre sí los escritores, que es justo lo que se busca."""
    conexion = conectar(ruta)
    try:
        if inmediata:
            # `isolation_level` por defecto haría que Python abriera la
            # transacción por su cuenta en la primera escritura, demasiado
            # tarde para proteger las lecturas previas.
            conexion.isolation_level = None
            conexion.execute("BEGIN IMMEDIATE")
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
        # Modo WAL: las lecturas dejan de esperar a que termine una
        # escritura en curso. Queda grabado en la base de datos, así que se
        # configura aquí una sola vez y no en cada conexión.
        #
        # `wal_autocheckpoint = 1` vuelca cada guardado al archivo principal
        # al momento, para que `antifragil.db` siga siendo un único archivo
        # completo (lo copian `sincronizar_servidor.py` y las copias de
        # seguridad, que no saben nada de archivos `-wal` aparte).
        conexion.execute("PRAGMA journal_mode = WAL")
        conexion.execute("PRAGMA wal_autocheckpoint = 1")
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
                ciclo_bono INTEGER NOT NULL DEFAULT 1,
                estado TEXT NOT NULL DEFAULT 'activo'
            )
            """
        )
        conexion.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_token ON clientes(token)")
        columnas_clientes = {fila["name"] for fila in conexion.execute("PRAGMA table_info(clientes)")}
        if "ciclo_bono" not in columnas_clientes:
            conexion.execute("ALTER TABLE clientes ADD COLUMN ciclo_bono INTEGER NOT NULL DEFAULT 1")
        if "estado" not in columnas_clientes:
            # Situación operativa del cliente: 'activo', 'pausado' o
            # 'cancelado' (2026-08-01). Un cliente que deja de entrenar NO se
            # borra: se archiva, conservando ficha, programa, sesiones,
            # historial, economía, deuda y enlace personal, y puede volver a
            # activo sin crear otra ficha.
            #
            # Es independiente de `pendiente_pago`: se puede estar pausado y
            # deber dinero, o cancelado y al día. Por eso una columna aparte
            # y no un cuarto valor de pago.
            #
            # Todos los clientes que ya existen quedan en 'activo', que es lo
            # que eran hasta ahora. `ALTER TABLE` con valor por defecto basta
            # y no toca ningún otro dato.
            conexion.execute("ALTER TABLE clientes ADD COLUMN estado TEXT NOT NULL DEFAULT 'activo'")
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
        if "hora" not in columnas:
            # Hora de firma (HH:MM), a partir del 2026-08-02. Las sesiones
            # anteriores se quedan en NULL a propósito: no se sabe a qué hora
            # fueron y no se va a inventar — la pantalla muestra solo la
            # fecha cuando falta.
            conexion.execute("ALTER TABLE historial_sesiones ADD COLUMN hora TEXT")
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
            # La tabla nueva se crea con el esquema COMPLETO actual
            # (incluida `ciclo_bono`) y se copia columna a columna sólo lo
            # que la tabla vieja tenía de verdad.
            #
            # Antes, la tabla nueva se creaba sin `ciclo_bono` y el INSERT
            # tampoco la copiaba: migrar una base con `UNIQUE` PERDÍA esa
            # columna y sus valores en silencio (la volvía a crear el
            # siguiente arranque, ya con todo a ciclo 1). Como el bloque de
            # `ALTER TABLE` de arriba se ejecuta ANTES de esta
            # reconstrucción, el orden hacía que el arreglo de un problema
            # deshiciera el del otro — confirmado con un test de migración
            # sobre el esquema antiguo (segunda auditoría, 2026-07-30).
            columnas_viejas = {fila["name"] for fila in conexion.execute("PRAGMA table_info(historial_sesiones)")}
            conexion.execute(
                """
                CREATE TABLE historial_sesiones_nueva (
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
            comunes = [
                columna
                for columna in (
                    "id", "cliente", "fecha", "tipo_programa", "numero_sesion",
                    "sesiones_totales", "tarifa", "ciclo_bono",
                )
                if columna in columnas_viejas
            ]
            lista = ", ".join(comunes)
            conexion.execute(
                f"INSERT INTO historial_sesiones_nueva ({lista}) SELECT {lista} FROM historial_sesiones"
            )
            conexion.execute("DROP TABLE historial_sesiones")
            conexion.execute("ALTER TABLE historial_sesiones_nueva RENAME TO historial_sesiones")
        # Cada bono concreto que ha contratado un cliente (2026-08-02).
        #
        # Un cliente puede contratar tres veces seguidas el mismo programa;
        # agrupar el historial por `tipo_programa` los mezclaría. La clave es
        # (cliente, ciclo_bono): `ciclo_bono` ya distingue cada renovación
        # desde el sprint de integridad del 2026-07-28, y `historial_sesiones`
        # ya lo guarda en cada fila.
        #
        # Deliberadamente NO se añade un `programa_cliente_id` a las
        # sesiones: sería un segundo enlace diciendo lo mismo que
        # (cliente, ciclo_bono), con el riesgo de que ambos se desincronicen
        # al editar o borrar. Además, toda la lógica de renovación y borrado
        # ya razona con `ciclo_bono`, así que no hay que reescribirla — y ahí
        # es justo donde vive el peligro para la economía.
        #
        # Esta tabla es DESCRIPTIVA: guarda los metadatos del bono (tarifa
        # con la que se contrató, fechas, si quedó pagado). La economía se
        # sigue calculando desde `historial_sesiones`, como siempre.
        conexion.execute(
            """
            CREATE TABLE IF NOT EXISTS programas_cliente (
                cliente TEXT NOT NULL REFERENCES clientes(nombre),
                ciclo_bono INTEGER NOT NULL,
                tipo_programa TEXT NOT NULL,
                tarifa REAL,
                sesiones_totales INTEGER NOT NULL,
                fecha_inicio TEXT,
                fecha_fin TEXT,
                pagado INTEGER,
                PRIMARY KEY (cliente, ciclo_bono)
            )
            """
        )
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
        columnas_firmas = {fila["name"] for fila in conexion.execute("PRAGMA table_info(firmas_publicas)")}
        if "sesion_id" not in columnas_firmas:
            # 2026-07-29, mismo día: al principio se confirmaba "el día",
            # no la sesión concreta — si Fernando firmaba dos sesiones el
            # mismo cliente el mismo día (algo que ya podía hacer desde el
            # 2026-07-24), solo se podía confirmar una vez para todo el
            # día. Ahora cada confirmación referencia la sesión concreta
            # de `historial_sesiones` que confirma.
            conexion.execute(
                "ALTER TABLE firmas_publicas ADD COLUMN sesion_id INTEGER REFERENCES historial_sesiones(id)"
            )

        # Ajustes mensuales explícitos (segunda auditoría, 2026-07-30).
        #
        # La vista mensual se calcula desde `historial_sesiones`, pero el
        # historial anterior al 2026-07-22 (cuando empezó la firma manual)
        # está incompleto: hay sesiones que SÍ se facturaron y cuya fecha
        # exacta nunca quedó registrada. Recalcular esos meses solo desde el
        # historial rebajaría cierres ya dados por buenos.
        #
        # Estas filas conservan esa diferencia de forma explícita: se suman
        # al mes, pero se muestran siempre como su propia línea con su
        # motivo, nunca mezcladas sin más en el total (requisito de
        # Fernando: la diferencia histórica debe quedar visible y
        # documentada, nunca oculta). `origen` distingue de dónde sale cada
        # ajuste, para poder recalcular los automáticos sin pisar uno puesto
        # a mano.
        conexion.execute(
            """
            CREATE TABLE IF NOT EXISTS ajustes_mensuales (
                anio INTEGER NOT NULL,
                mes INTEGER NOT NULL,
                origen TEXT NOT NULL DEFAULT 'legacy',
                importe REAL NOT NULL DEFAULT 0,
                horas INTEGER NOT NULL DEFAULT 0,
                motivo TEXT NOT NULL,
                PRIMARY KEY (anio, mes, origen)
            )
            """
        )
