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
import sqlite3
from datetime import date
from pathlib import Path

from basedatos import RUTA_POR_DEFECTO, conectar
from programas.logica import ActualizacionPrograma


ESTADOS_VALIDOS = ("activo", "pausado", "cancelado")

ESTADO_POR_DEFECTO = "activo"


def validar_estado(estado: str) -> str:
    """Comprueba que el estado es uno de los tres permitidos.

    `estado` describe la situación operativa del cliente y es INDEPENDIENTE
    de `pendiente_pago`: se puede estar pausado debiendo dinero, o cancelado
    y al día. Por eso no se mezclan en un solo campo."""
    if estado not in ESTADOS_VALIDOS:
        raise ValueError(
            f"Estado de cliente no válido: '{estado}'. Debe ser uno de: {', '.join(ESTADOS_VALIDOS)}"
        )
    return estado


def leer_clientes(ruta: Path = RUTA_POR_DEFECTO) -> dict[str, dict]:
    """Devuelve {cliente: {tipo_programa, tarifa, sesiones_totales,
    sesiones_completadas, pendiente_pago, token, estado}}.

    Fernando anota las sesiones "completadas" (consumidas del bono actual),
    no las que le quedan. `a_programa` hace la conversión a "restantes"
    para la lógica de `programas`.
    """
    with conectar(ruta) as conexion:
        filas = conexion.execute(
            """
            SELECT c.nombre, c.tipo_programa, p.tarifa, p.sesiones_totales,
                   c.sesiones_completadas, c.pendiente_pago, c.token, c.estado
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
            "estado": fila["estado"] or ESTADO_POR_DEFECTO,
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
    if tarifa <= 0:
        raise ValueError("La tarifa debe ser un número positivo")
    if sesiones_totales <= 0:
        raise ValueError("El número de sesiones del programa debe ser positivo")

    with conectar(ruta) as conexion:
        conexion.execute(
            "INSERT INTO programas (nombre, tarifa, sesiones_totales) VALUES (?, ?, ?) "
            "ON CONFLICT(nombre) DO UPDATE SET tarifa = excluded.tarifa, sesiones_totales = excluded.sesiones_totales",
            (nombre, tarifa, sesiones_totales),
        )


def _validar_sesiones_completadas(sesiones_completadas: int, tipo_programa: str, conexion) -> None:
    if sesiones_completadas < 0:
        raise ValueError("Las sesiones completadas no pueden ser negativas")
    programa = conexion.execute(
        "SELECT sesiones_totales FROM programas WHERE nombre = ?", (tipo_programa,)
    ).fetchone()
    if programa is None:
        raise ValueError(f"El programa '{tipo_programa}' no existe")
    # Justo al completar un bono el contador puede llegar a igualar el
    # total (antes de que la renovación lo reinicie a 0) — se permite hasta
    # ese límite, no más allá.
    if sesiones_completadas > programa["sesiones_totales"]:
        raise ValueError(
            f"Las sesiones completadas ({sesiones_completadas}) no pueden superar las del "
            f"programa '{tipo_programa}' ({programa['sesiones_totales']})"
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
        _validar_sesiones_completadas(sesiones_completadas, tipo_programa, conexion)
        # Todo cliente nuevo empieza activo: quien se da de alta viene a
        # entrenar. No hay selector de estado en el alta a propósito.
        conexion.execute(
            "INSERT INTO clientes (nombre, tipo_programa, sesiones_completadas, pendiente_pago, token, estado) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                nombre, tipo_programa, sesiones_completadas, int(pendiente_pago),
                secrets.token_urlsafe(24), ESTADO_POR_DEFECTO,
            ),
        )


def actualizar_cliente(
    nombre: str,
    nuevo_nombre: str,
    tipo_programa: str,
    sesiones_completadas: int,
    pendiente_pago: bool,
    ruta: Path = RUTA_POR_DEFECTO,
    estado: str | None = None,
) -> None:
    """Edición manual de un cliente concreto (usada por la web app): nombre,
    tipo de programa, sesiones completadas, pendiente de pago y estado, sin
    pasar por la lógica de renovación de `programas.procesar` — es una
    corrección puntual, no un cierre semanal.

    `estado`: 'activo', 'pausado' o 'cancelado'. Si se deja en `None`, el
    estado no se toca — así las llamadas anteriores a que existiera esta
    columna siguen funcionando igual. Cambiar el estado NO altera programa,
    sesiones, historial, economía, deuda ni token: solo dice si el cliente
    está entrenando ahora mismo.

    Si `nuevo_nombre` es distinto de `nombre`, cambia también el nombre del
    cliente — y con él, el de todas sus filas en `historial_sesiones`, en
    la MISMA transacción (si no, `historial_sesiones.cliente` se quedaría
    apuntando a un nombre que ya no existe — una violación de clave foránea
    que antes no se evitaba activamente; sprint de integridad, 2026-07-28).
    Hay que renombrar igual las sesiones en Google Calendar, o el sistema
    dejaría de reconocerlas (el nombre es la clave que las cruza)."""
    nuevo_nombre = nuevo_nombre.strip()
    if not nuevo_nombre:
        raise ValueError("El nombre del cliente no puede estar vacío")

    try:
        with conectar(ruta) as conexion:
            # Al renombrar, `clientes` y `historial_sesiones` quedan
            # inconsistentes entre sí durante un instante (uno ya tiene el
            # nombre nuevo, el otro todavía no) — sin aplazar la
            # comprobación de clave foránea hasta el final de la
            # transacción, SQLite la rechaza a mitad de camino aunque el
            # resultado final sea correcto (encontrado por el propio test
            # de este sprint, 2026-07-28).
            #
            # `defer_foreign_keys` solo se mantiene activo DENTRO de una
            # transacción explícita — si no se abre con `BEGIN` primero,
            # Python trata cada sentencia como su propia transacción
            # aparte y el aplazamiento se pierde antes de llegar a los
            # UPDATE (encontrado también en este sprint, probando el
            # propio arreglo).
            conexion.execute("BEGIN")
            conexion.execute("PRAGMA defer_foreign_keys = ON")

            existe = conexion.execute("SELECT 1 FROM clientes WHERE nombre = ?", (nombre,)).fetchone()
            if not existe:
                raise ValueError(f"No existe el cliente '{nombre}'")
            if nuevo_nombre != nombre:
                colision = conexion.execute("SELECT 1 FROM clientes WHERE nombre = ?", (nuevo_nombre,)).fetchone()
                if colision:
                    raise ValueError(f"Ya existe un cliente llamado '{nuevo_nombre}'")
            _validar_sesiones_completadas(sesiones_completadas, tipo_programa, conexion)

            if estado is None:
                conexion.execute(
                    "UPDATE clientes SET nombre = ?, tipo_programa = ?, sesiones_completadas = ?, "
                    "pendiente_pago = ? WHERE nombre = ?",
                    (nuevo_nombre, tipo_programa, sesiones_completadas, int(pendiente_pago), nombre),
                )
            else:
                validar_estado(estado)
                conexion.execute(
                    "UPDATE clientes SET nombre = ?, tipo_programa = ?, sesiones_completadas = ?, "
                    "pendiente_pago = ?, estado = ? WHERE nombre = ?",
                    (nuevo_nombre, tipo_programa, sesiones_completadas, int(pendiente_pago), estado, nombre),
                )
            if nuevo_nombre != nombre:
                conexion.execute(
                    "UPDATE historial_sesiones SET cliente = ? WHERE cliente = ?", (nuevo_nombre, nombre)
                )
    except sqlite3.IntegrityError as error:
        raise ValueError(
            f"No se pudo renombrar a '{nuevo_nombre}': hay datos de otra tabla que todavía "
            f"apuntan al nombre antiguo ({error})"
        ) from error


def eliminar_cliente(nombre: str, ruta: Path = RUTA_POR_DEFECTO, conexion: sqlite3.Connection | None = None) -> None:
    """Borra la ficha de un cliente. Se niega a hacerlo si todavía le
    quedan sesiones en el historial — hay que borrarlas antes una a una
    (`registrar_asistencia.eliminar_cliente_con_historial` lo hace) para
    que su dinero se descuente también de la economía de cada semana. Sin
    esa condición, borrar un cliente dejaría su facturación contada para
    siempre en unas semanas cuyas sesiones ya no existen."""

    def _hacer(conexion: sqlite3.Connection) -> None:
        existe = conexion.execute("SELECT 1 FROM clientes WHERE nombre = ?", (nombre,)).fetchone()
        if not existe:
            raise ValueError(f"No existe el cliente '{nombre}'")

        pendientes = conexion.execute(
            "SELECT COUNT(*) AS n FROM historial_sesiones WHERE cliente = ?", (nombre,)
        ).fetchone()["n"]
        if pendientes:
            raise ValueError(
                f"'{nombre}' todavía tiene {pendientes} sesiones en su historial — hay que borrarlas antes "
                "para que su facturación se descuente de la economía"
            )

        conexion.execute("DELETE FROM firmas_publicas WHERE cliente = ?", (nombre,))
        conexion.execute("DELETE FROM clientes WHERE nombre = ?", (nombre,))

    if conexion is not None:
        _hacer(conexion)
    else:
        with conectar(ruta) as conexion:
            _hacer(conexion)


def registrar_historial(
    historial: dict[str, list[dict]], ruta: Path = RUTA_POR_DEFECTO, conexion: sqlite3.Connection | None = None
) -> None:
    """Guarda el historial de sesiones (fecha -> nº de bono) calculado por
    `programas.procesar.procesar_semana`. Solo se llama tras confirmación
    explícita, igual que `aplicar_actualizaciones` — de hecho siempre se
    llama junto a ella, en el mismo cierre semanal.

    Cada llamada añade una fila nueva — un cliente puede tener varias
    sesiones el mismo día si hace falta (decisión de Fernando, 2026-07-24:
    antes `UNIQUE(cliente, fecha)` lo impedía; cada sesión se identifica
    ahora por su propio `id`, no por la fecha). Cada entrada puede incluir
    `ciclo_bono` (a qué renovación de bono pertenece — sprint de
    integridad, 2026-07-28); si no se indica, se guarda como ciclo 1.

    `conexion`: para que firmar una sesión sea una única transacción
    atómica junto con `aplicar_actualizaciones` y la economía (ver
    `registrar_asistencia.py`)."""

    def _hacer(conexion: sqlite3.Connection) -> None:
        for cliente, entradas in historial.items():
            for entrada in entradas:
                conexion.execute(
                    "INSERT INTO historial_sesiones "
                    "(cliente, fecha, tipo_programa, numero_sesion, sesiones_totales, tarifa, ciclo_bono) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        cliente,
                        entrada["fecha"],
                        entrada["tipo_programa"],
                        entrada["numero_sesion"],
                        entrada["sesiones_totales"],
                        entrada.get("tarifa"),
                        entrada.get("ciclo_bono", 1),
                    ),
                )

    if conexion is not None:
        _hacer(conexion)
    else:
        with conectar(ruta) as conexion:
            _hacer(conexion)


def obtener_historial(nombre: str, ruta: Path = RUTA_POR_DEFECTO) -> list[dict]:
    """Historial de sesiones de un cliente, de la más reciente a la más
    antigua (si hay varias el mismo día, la añadida más tarde va primero).
    Incluye la tarifa con la que se facturó esa sesión en su momento."""
    with conectar(ruta) as conexion:
        filas = conexion.execute(
            "SELECT id, fecha, tipo_programa, numero_sesion, sesiones_totales, tarifa, ciclo_bono "
            "FROM historial_sesiones WHERE cliente = ? ORDER BY fecha DESC, id DESC",
            (nombre,),
        ).fetchall()
    return [dict(fila) for fila in filas]


def marcar_pendiente_pago(
    cliente: str, valor: bool, ruta: Path = RUTA_POR_DEFECTO, conexion: sqlite3.Connection | None = None
) -> None:
    """Cambia solo el estado de pago pendiente, sin tocar nada más — usado
    por `registrar_asistencia.eliminar_sesion_pt` para deshacer una
    renovación de bono cuando se borra la sesión que la causó (decisión de
    Fernando, 2026-07-24)."""
    if conexion is not None:
        conexion.execute("UPDATE clientes SET pendiente_pago = ? WHERE nombre = ?", (int(valor), cliente))
        return
    with conectar(ruta) as conexion:
        conexion.execute("UPDATE clientes SET pendiente_pago = ? WHERE nombre = ?", (int(valor), cliente))


def _sincronizar_completadas_con_ultima(conexion, cliente: str) -> None:
    """Tras editar o borrar una entrada del historial, las sesiones
    completadas del cliente deben seguir coincidiendo con la más reciente
    que quede **del ciclo de bono actual** — no con la más reciente de
    cualquier ciclo. Antes de esta corrección (sprint de integridad,
    2026-07-28), borrar la única sesión de un bono recién renovado hacía
    que el contador volviera a mostrar el número de sesión del bono
    ANTERIOR (bug confirmado y reproducido: 12 de 12 → renovar → firmar
    sesión 1 del nuevo → borrarla → el contador volvía a poner "12", en vez
    de "0"). Si no queda ninguna sesión del ciclo actual, el cliente vuelve
    a 0 completadas de ese ciclo, que es lo correcto: un bono recién
    empezado sin ninguna sesión firmada todavía.

    Si hay varias sesiones el mismo día, "la más reciente" es la que se
    añadió después (id más alto) — decisión de Fernando, 2026-07-24."""
    ciclo_actual = conexion.execute("SELECT ciclo_bono FROM clientes WHERE nombre = ?", (cliente,)).fetchone()
    if ciclo_actual is None:
        return
    ultima = conexion.execute(
        "SELECT numero_sesion FROM historial_sesiones WHERE cliente = ? AND ciclo_bono = ? "
        "ORDER BY fecha DESC, id DESC LIMIT 1",
        (cliente, ciclo_actual["ciclo_bono"]),
    ).fetchone()
    nuevas_completadas = ultima["numero_sesion"] if ultima else 0
    conexion.execute(
        "UPDATE clientes SET sesiones_completadas = ? WHERE nombre = ?",
        (nuevas_completadas, cliente),
    )


def editar_historial(
    entrada_id: int, nueva_fecha: str, nuevo_numero_sesion: int, ruta: Path = RUTA_POR_DEFECTO,
    conexion: sqlite3.Connection | None = None,
) -> dict:
    """Corrige una entrada ya guardada del historial (fecha y/o número de
    sesión) — para arreglar errores como un número de sesión equivocado.
    Cada entrada se identifica por su `id`, no por (cliente, fecha) — un
    cliente puede tener varias sesiones el mismo día (decisión de
    Fernando, 2026-07-24). Si la entrada corregida sigue siendo la más
    reciente de su ciclo de bono (o pasa a serlo), las sesiones completadas
    del cliente se ajustan también. Devuelve la entrada tal como quedó, con
    su cliente y su tarifa histórica (nunca la tarifa actual del cliente —
    sprint de integridad, 2026-07-28)."""

    def _hacer(conexion: sqlite3.Connection) -> dict:
        fila = conexion.execute(
            "SELECT cliente, sesiones_totales, tarifa FROM historial_sesiones WHERE id = ?", (entrada_id,)
        ).fetchone()
        if fila is None:
            raise ValueError("Esa entrada del historial ya no existe")
        cliente, sesiones_totales, tarifa = fila["cliente"], fila["sesiones_totales"], fila["tarifa"]

        try:
            date.fromisoformat(nueva_fecha)
        except ValueError as error:
            raise ValueError(f"Fecha inválida: '{nueva_fecha}'") from error
        if not (1 <= nuevo_numero_sesion <= sesiones_totales):
            raise ValueError(
                f"El número de sesión debe estar entre 1 y {sesiones_totales} (de este programa)"
            )

        conexion.execute(
            "UPDATE historial_sesiones SET fecha = ?, numero_sesion = ? WHERE id = ?",
            (nueva_fecha, nuevo_numero_sesion, entrada_id),
        )
        _sincronizar_completadas_con_ultima(conexion, cliente)
        return {
            "id": entrada_id, "cliente": cliente, "fecha": nueva_fecha,
            "numero_sesion": nuevo_numero_sesion, "tarifa": tarifa,
        }

    if conexion is not None:
        return _hacer(conexion)
    with conectar(ruta) as conexion:
        return _hacer(conexion)


def eliminar_historial(
    entrada_id: int, ruta: Path = RUTA_POR_DEFECTO, conexion: sqlite3.Connection | None = None
) -> dict:
    """Borra una entrada del historial por su `id` (p. ej. un toque de más
    en "Firmar sesión" por error). Devuelve la entrada borrada (con su
    tarifa histórica) — para poder también deshacer su aportación
    económica, ver `registrar_asistencia.py`.

    Si el cliente había confirmado esa sesión desde su enlace personal, la
    confirmación se borra con ella: `firmas_publicas.sesion_id` apunta a
    esta fila, así que dejarla ahí rompía el borrado con un error de clave
    foránea (encontrado por el test de borrado de cliente del 2026-07-29 —
    afectaba también a borrar a mano una sesión ya confirmada)."""

    def _hacer(conexion: sqlite3.Connection) -> dict:
        fila = conexion.execute(
            "SELECT cliente, fecha, numero_sesion, sesiones_totales, tipo_programa, tarifa FROM historial_sesiones "
            "WHERE id = ?",
            (entrada_id,),
        ).fetchone()
        if fila is None:
            raise ValueError("Esa entrada del historial ya no existe")
        entrada = dict(fila)
        entrada["id"] = entrada_id
        cliente = entrada["cliente"]

        conexion.execute("DELETE FROM firmas_publicas WHERE sesion_id = ?", (entrada_id,))
        conexion.execute("DELETE FROM historial_sesiones WHERE id = ?", (entrada_id,))
        _sincronizar_completadas_con_ultima(conexion, cliente)
        return entrada

    if conexion is not None:
        return _hacer(conexion)
    with conectar(ruta) as conexion:
        return _hacer(conexion)


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
    resultados: dict[str, ActualizacionPrograma], ruta: Path = RUTA_POR_DEFECTO,
    conexion: sqlite3.Connection | None = None,
) -> None:
    """Escribe las sesiones completadas y el pendiente de pago ya calculados
    (convirtiendo de "restantes" a "completadas"). Solo se llama después de
    que Fernando confirme el resumen del cierre semanal, o al firmar una
    sesión al momento.

    Si `actualizacion.renovado`, el cliente pasa a un ciclo de bono nuevo
    (`ciclo_bono += 1`) — así se puede saber a qué renovación pertenece
    cada sesión del historial (sprint de integridad, 2026-07-28). Nota: si
    en una sola llamada un cliente renovara más de una vez de golpe (poco
    realista, y solo posible por la ruta antigua de cierre por lotes, hoy
    en desuso), el ciclo solo avanza en 1 — limitación conocida y aceptada
    de esa ruta, no de la firma en el momento."""

    def _hacer(conexion: sqlite3.Connection) -> None:
        for nombre, actualizacion in resultados.items():
            fila = conexion.execute(
                "SELECT p.sesiones_totales, c.ciclo_bono FROM clientes c "
                "JOIN programas p ON p.nombre = c.tipo_programa WHERE c.nombre = ?",
                (nombre,),
            ).fetchone()
            sesiones_totales = int(fila["sesiones_totales"])
            sesiones_completadas = sesiones_totales - actualizacion.sesiones_restantes
            nuevo_ciclo = fila["ciclo_bono"] + 1 if actualizacion.renovado else fila["ciclo_bono"]
            conexion.execute(
                "UPDATE clientes SET sesiones_completadas = ?, pendiente_pago = ?, ciclo_bono = ? WHERE nombre = ?",
                (sesiones_completadas, int(actualizacion.pendiente_pago), nuevo_ciclo, nombre),
            )

    if conexion is not None:
        _hacer(conexion)
    else:
        with conectar(ruta) as conexion:
            _hacer(conexion)
