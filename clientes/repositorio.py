"""Lectura y escritura de la base de datos de clientes.

Desde el 2026-07-18, esto es SQLite (`datos/antifragil.db`, ver
`basedatos.py`) — antes era un Excel. Se mantienen exactamente las mismas
funciones y formas de datos que ya usaba el resto del proyecto
(`programas/procesar.py`, `cierre_semanal/`, `webapp/app.py`), así que ese
código no ha necesitado cambiar.

Ventaja frente al Excel: no hay fórmulas que pierdan su valor calculado al
guardar, ni desplegables que Excel reescriba en un formato que la librería
no entienda, ni bloqueos por tener el archivo abierto — problemas reales
que se documentaron en `.claude/skills/lessons-learned/log.md` y que
desaparecen con una base de datos de verdad.
"""

import secrets
from pathlib import Path

from basedatos import RUTA_POR_DEFECTO, conectar
from programas.logica import ActualizacionPrograma


def leer_clientes(ruta: Path = RUTA_POR_DEFECTO) -> dict[str, dict]:
    """Devuelve {cliente: {tipo_programa, tarifa, sesiones_totales,
    sesiones_completadas, pendiente_pago, token}}.

    Fernando anota las sesiones "completadas" (consumidas del bono actual),
    no las que le quedan. `a_programa` hace la conversión a "restantes"
    para la lógica de `programas`.
    """
    with conectar(ruta) as conexion:
        filas = conexion.execute(
            """
            SELECT c.nombre, c.tipo_programa, p.tarifa, p.sesiones_totales,
                   c.sesiones_completadas, c.pendiente_pago, c.token
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
            "token": fila["token"],
        }
        for fila in filas
    }


def a_programa(fila: dict) -> dict | None:
    """Convierte una fila en el formato que espera `programas.procesar`
    (que trabaja en "sesiones restantes", no "completadas").

    Devuelve None si al cliente le faltan datos por rellenar — así se
    puede avisar a Fernando en vez de calcular con números inventados.
    """
    try:
        sesiones_totales = int(fila["sesiones_totales"])
        sesiones_completadas = int(fila["sesiones_completadas"])
        return {
            "sesiones_restantes": sesiones_totales - sesiones_completadas,
            "sesiones_totales": sesiones_totales,
            "pendiente_pago": str(fila["pendiente_pago"]).strip().lower() in ("sí", "si"),
            "tipo_programa": fila["tipo_programa"],
        }
    except (TypeError, ValueError):
        return None


def cargar_programas(ruta: Path = RUTA_POR_DEFECTO) -> tuple[dict[str, dict], list[str]]:
    """Lee la base de datos y la deja lista para
    `programas.procesar.procesar_semana`.

    Devuelve (programas, incompletos): los clientes sin tarifa/sesiones
    rellenas todavía se listan aparte en vez de calcular con datos inventados.
    """
    clientes = leer_clientes(ruta)
    programas: dict[str, dict] = {}
    incompletos: list[str] = []

    for nombre, fila in clientes.items():
        programa = a_programa(fila)
        if programa is None:
            incompletos.append(nombre)
        else:
            programas[nombre] = programa

    return programas, incompletos


def cargar_tarifas(ruta: Path = RUTA_POR_DEFECTO) -> dict[str, float]:
    """Devuelve {cliente: tarifa} — usado por `economia.calculo` para la
    facturación semanal."""
    clientes = leer_clientes(ruta)
    tarifas: dict[str, float] = {}
    for nombre, fila in clientes.items():
        try:
            tarifas[nombre] = float(fila["tarifa"])
        except (TypeError, ValueError):
            continue
    return tarifas


def listar_tipos_programa(ruta: Path = RUTA_POR_DEFECTO) -> list[str]:
    """Nombres de programa disponibles, para el desplegable de la web app."""
    with conectar(ruta) as conexion:
        filas = conexion.execute("SELECT nombre FROM programas ORDER BY nombre").fetchall()
    return [fila["nombre"] for fila in filas]


def guardar_programa(nombre: str, tarifa: float, sesiones_totales: int, ruta: Path = RUTA_POR_DEFECTO) -> None:
    """Da de alta o actualiza un programa (tarifas y bonos — ver
    docs/TARIFAS.md). Si Fernando cambia un precio, solo hay que llamar a
    esto de nuevo con el mismo nombre."""
    with conectar(ruta) as conexion:
        conexion.execute(
            "INSERT INTO programas (nombre, tarifa, sesiones_totales) VALUES (?, ?, ?) "
            "ON CONFLICT(nombre) DO UPDATE SET tarifa = excluded.tarifa, sesiones_totales = excluded.sesiones_totales",
            (nombre, tarifa, sesiones_totales),
        )


def crear_cliente(
    nombre: str, tipo_programa: str, sesiones_completadas: int, pendiente_pago: bool, ruta: Path = RUTA_POR_DEFECTO
) -> None:
    """Da de alta un cliente nuevo. Solo se llama tras confirmación
    explícita (ver `webapp/app.py`)."""
    nombre = nombre.strip()
    if not nombre:
        raise ValueError("El nombre del cliente no puede estar vacío")

    with conectar(ruta) as conexion:
        existe = conexion.execute("SELECT 1 FROM clientes WHERE nombre = ?", (nombre,)).fetchone()
        if existe:
            raise ValueError(f"Ya existe un cliente llamado '{nombre}'")
        conexion.execute(
            "INSERT INTO clientes (nombre, tipo_programa, sesiones_completadas, pendiente_pago, token) "
            "VALUES (?, ?, ?, ?, ?)",
            (nombre, tipo_programa, sesiones_completadas, int(pendiente_pago), secrets.token_urlsafe(24)),
        )


def actualizar_cliente(
    nombre: str,
    nuevo_nombre: str,
    tipo_programa: str,
    sesiones_completadas: int,
    pendiente_pago: bool,
    ruta: Path = RUTA_POR_DEFECTO,
) -> None:
    """Edición manual de un cliente concreto (usada por la web app): nombre,
    tipo de programa, sesiones completadas y pendiente de pago, sin pasar
    por la lógica de renovación de `programas.procesar` — es una
    corrección puntual, no un cierre semanal.

    Si `nuevo_nombre` es distinto de `nombre`, cambia también el nombre del
    cliente — hay que renombrar igual las sesiones en Google Calendar, o el
    sistema dejaría de reconocerlas (el nombre es la clave que las cruza)."""
    nuevo_nombre = nuevo_nombre.strip()
    if not nuevo_nombre:
        raise ValueError("El nombre del cliente no puede estar vacío")

    with conectar(ruta) as conexion:
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


def registrar_historial(historial: dict[str, list[dict]], ruta: Path = RUTA_POR_DEFECTO) -> None:
    """Guarda el historial de sesiones (fecha -> nº de bono) calculado por
    `programas.procesar.procesar_semana`. Solo se llama tras confirmación
    explícita, igual que `aplicar_actualizaciones` — de hecho siempre se
    llama junto a ella, en el mismo cierre semanal.

    Cada llamada añade una fila nueva — un cliente puede tener varias
    sesiones el mismo día si hace falta (decisión de Fernando, 2026-07-24:
    antes `UNIQUE(cliente, fecha)` lo impedía; cada sesión se identifica
    ahora por su propio `id`, no por la fecha)."""
    with conectar(ruta) as conexion:
        for cliente, entradas in historial.items():
            for entrada in entradas:
                conexion.execute(
                    "INSERT INTO historial_sesiones (cliente, fecha, tipo_programa, numero_sesion, sesiones_totales, tarifa) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        cliente,
                        entrada["fecha"],
                        entrada["tipo_programa"],
                        entrada["numero_sesion"],
                        entrada["sesiones_totales"],
                        entrada.get("tarifa"),
                    ),
                )


def obtener_historial(nombre: str, ruta: Path = RUTA_POR_DEFECTO) -> list[dict]:
    """Historial de sesiones de un cliente, de la más reciente a la más
    antigua (si hay varias el mismo día, la añadida más tarde va primero)."""
    with conectar(ruta) as conexion:
        filas = conexion.execute(
            "SELECT id, fecha, tipo_programa, numero_sesion, sesiones_totales "
            "FROM historial_sesiones WHERE cliente = ? ORDER BY fecha DESC, id DESC",
            (nombre,),
        ).fetchall()
    return [dict(fila) for fila in filas]


def marcar_pendiente_pago(cliente: str, valor: bool, ruta: Path = RUTA_POR_DEFECTO) -> None:
    """Cambia solo el estado de pago pendiente, sin tocar nada más — usado
    por `registrar_asistencia.eliminar_sesion_pt` para deshacer una
    renovación de bono cuando se borra la sesión que la causó (decisión de
    Fernando, 2026-07-24)."""
    with conectar(ruta) as conexion:
        conexion.execute("UPDATE clientes SET pendiente_pago = ? WHERE nombre = ?", (int(valor), cliente))


def _sincronizar_completadas_con_ultima(conexion, cliente: str) -> None:
    """Tras editar o borrar una entrada del historial, las sesiones
    completadas del cliente deben seguir coincidiendo con la más reciente
    que quede — si no, la tarjeta y el historial dirían números distintos
    (justo el error que motivó esta función, 2026-07-22). Si hay varias
    sesiones el mismo día, "la más reciente" es la que se añadió después
    (id más alto) — decisión de Fernando, 2026-07-24."""
    ultima = conexion.execute(
        "SELECT numero_sesion FROM historial_sesiones WHERE cliente = ? ORDER BY fecha DESC, id DESC LIMIT 1",
        (cliente,),
    ).fetchone()
    if ultima:
        conexion.execute(
            "UPDATE clientes SET sesiones_completadas = ? WHERE nombre = ?",
            (ultima["numero_sesion"], cliente),
        )


def editar_historial(entrada_id: int, nueva_fecha: str, nuevo_numero_sesion: int, ruta: Path = RUTA_POR_DEFECTO) -> dict:
    """Corrige una entrada ya guardada del historial (fecha y/o número de
    sesión) — para arreglar errores como un número de sesión equivocado.
    Cada entrada se identifica por su `id`, no por (cliente, fecha) — un
    cliente puede tener varias sesiones el mismo día (decisión de
    Fernando, 2026-07-24). Si la entrada corregida sigue siendo la más
    reciente (o pasa a serlo), las sesiones completadas del cliente se
    ajustan también. Devuelve la entrada tal como quedó, con su cliente."""
    with conectar(ruta) as conexion:
        fila = conexion.execute(
            "SELECT cliente FROM historial_sesiones WHERE id = ?", (entrada_id,)
        ).fetchone()
        if fila is None:
            raise ValueError("Esa entrada del historial ya no existe")
        cliente = fila["cliente"]

        conexion.execute(
            "UPDATE historial_sesiones SET fecha = ?, numero_sesion = ? WHERE id = ?",
            (nueva_fecha, nuevo_numero_sesion, entrada_id),
        )
        _sincronizar_completadas_con_ultima(conexion, cliente)

    return {"id": entrada_id, "cliente": cliente, "fecha": nueva_fecha, "numero_sesion": nuevo_numero_sesion}


def eliminar_historial(entrada_id: int, ruta: Path = RUTA_POR_DEFECTO) -> dict:
    """Borra una entrada del historial por su `id` (p. ej. un toque de más
    en "Firmar sesión" por error). Devuelve la entrada borrada — para poder
    también deshacer su aportación económica, ver `registrar_asistencia.py`."""
    with conectar(ruta) as conexion:
        fila = conexion.execute(
            "SELECT cliente, fecha, numero_sesion, sesiones_totales, tipo_programa FROM historial_sesiones "
            "WHERE id = ?",
            (entrada_id,),
        ).fetchone()
        if fila is None:
            raise ValueError("Esa entrada del historial ya no existe")
        entrada = dict(fila)
        entrada["id"] = entrada_id
        cliente = entrada["cliente"]

        conexion.execute("DELETE FROM historial_sesiones WHERE id = ?", (entrada_id,))
        _sincronizar_completadas_con_ultima(conexion, cliente)

    return entrada


def obtener_cliente_por_token(token: str, ruta: Path = RUTA_POR_DEFECTO) -> tuple[str, dict] | None:
    """Busca al cliente dueño de este enlace personal (ver `/mi/<token>` en
    `webapp/app.py`, milestone 4: cada cliente ve su propio bono e
    historial sin necesitar la contraseña de Fernando)."""
    for nombre, datos in leer_clientes(ruta).items():
        if datos.get("token") == token:
            return nombre, datos
    return None


def asegurar_tokens(ruta: Path = RUTA_POR_DEFECTO) -> int:
    """Genera un token a los clientes que todavía no tengan uno (los dados
    de alta antes de que existiera esta función). Devuelve cuántos se
    generaron. Segura de repetir."""
    generados = 0
    with conectar(ruta) as conexion:
        filas = conexion.execute("SELECT nombre FROM clientes WHERE token IS NULL").fetchall()
        for fila in filas:
            conexion.execute(
                "UPDATE clientes SET token = ? WHERE nombre = ?",
                (secrets.token_urlsafe(24), fila["nombre"]),
            )
            generados += 1
    return generados


def aplicar_actualizaciones(
    resultados: dict[str, ActualizacionPrograma], ruta: Path = RUTA_POR_DEFECTO
) -> None:
    """Escribe las sesiones completadas y el pendiente de pago ya calculados
    (convirtiendo de "restantes" a "completadas"). Solo se llama después de
    que Fernando confirme el resumen del cierre semanal."""
    clientes = leer_clientes(ruta)
    with conectar(ruta) as conexion:
        for nombre, actualizacion in resultados.items():
            sesiones_totales = int(clientes[nombre]["sesiones_totales"])
            sesiones_completadas = sesiones_totales - actualizacion.sesiones_restantes
            conexion.execute(
                "UPDATE clientes SET sesiones_completadas = ?, pendiente_pago = ? WHERE nombre = ?",
                (sesiones_completadas, int(actualizacion.pendiente_pago), nombre),
            )
