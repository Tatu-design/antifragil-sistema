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
from servicios.modalidades import (
    BONO,
    ETIQUETAS as ETIQUETAS_MODALIDAD,
    MODALIDAD_POR_DEFECTO,
    es_mensual,
    validar_condiciones,
    validar_modalidad,
)


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

    Desde el 2026-08-03 las condiciones económicas (tarifa, sesiones, cuota)
    se leen del CICLO EN CURSO del cliente (`programas_cliente`), no de la
    lista global `programas`. La lista global queda como atajo para dar de
    alta un bono rápido, pero ya no manda: cada cliente puede tener sus
    propias condiciones sin que exista un programa predefinido con ese
    nombre.

    El `JOIN` con `programas` pasa a ser `LEFT JOIN` — y esto es lo más
    importante de todo el cambio. Con el `JOIN` normal, un cliente cuyo
    `tipo_programa` no estuviera en la lista global DESAPARECÍA de la
    aplicación entera: de la lista, de su ficha y de la economía. Con
    condiciones propias por cliente eso pasaría constantemente.
    """
    with conectar(ruta) as conexion:
        filas = conexion.execute(
            """
            SELECT c.nombre, c.sesiones_completadas, c.pendiente_pago, c.token,
                   c.estado, c.ciclo_bono,
                   -- Si el cliente tiene ficha de su ciclo en curso, manda ella
                   -- por completo. Nada de mezclar a medias con la lista
                   -- global: una mensualidad no tiene tarifa por sesión, y
                   -- rellenarla desde `programas` le pondría un precio que no
                   -- le corresponde y la cobraría dos veces.
                   CASE WHEN pc.cliente IS NULL THEN c.tipo_programa ELSE pc.tipo_programa END AS tipo_programa,
                   CASE WHEN pc.cliente IS NULL THEN p.tarifa ELSE pc.tarifa END AS tarifa,
                   CASE WHEN pc.cliente IS NULL THEN p.sesiones_totales ELSE pc.sesiones_totales END AS sesiones_totales,
                   COALESCE(pc.modalidad, 'bono') AS modalidad,
                   pc.precio_total, pc.cuota_mensual, pc.sesiones_referencia,
                   pc.anio, pc.mes,
                   -- Sesiones realmente firmadas en el ciclo en curso. Para un
                   -- bono coincide con `sesiones_completadas`; para una
                   -- mensualidad o una cuenta es la única cuenta que existe,
                   -- porque ahí no se consume nada.
                   (SELECT COUNT(*) FROM historial_sesiones h
                     WHERE h.cliente = c.nombre AND h.ciclo_bono = c.ciclo_bono) AS sesiones_ciclo,
                   -- Servicios YA CERRADOS que siguen sin cobrarse (2026-08-04).
                   -- Una deuda no desaparece porque el periodo termine: una
                   -- cuenta de cliente se cobra al acabar el mes, y un bono
                   -- puede quedar a deber después de agotarse. Se cuentan solo
                   -- los distintos del ciclo en curso, porque el de ahora lo
                   -- describe `clientes.pendiente_pago` — así las dos fuentes
                   -- no pueden contradecirse.
                   (SELECT COUNT(*) FROM programas_cliente pc2
                     WHERE pc2.cliente = c.nombre AND pc2.ciclo_bono <> c.ciclo_bono
                       AND pc2.pagado = 0) AS ciclos_pendientes
            FROM clientes c
            LEFT JOIN programas p ON p.nombre = c.tipo_programa
            LEFT JOIN programas_cliente pc
                   ON pc.cliente = c.nombre AND pc.ciclo_bono = c.ciclo_bono
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
            "modalidad": fila["modalidad"] or MODALIDAD_POR_DEFECTO,
            "ciclo_bono": fila["ciclo_bono"],
            "sesiones_ciclo": fila["sesiones_ciclo"],
            "ciclos_pendientes": fila["ciclos_pendientes"],
            "precio_total": fila["precio_total"],
            "cuota_mensual": fila["cuota_mensual"],
            "sesiones_referencia": fila["sesiones_referencia"],
            "anio": fila["anio"],
            "mes": fila["mes"],
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


def _puntero_de_programa_valido(tipo_programa: str, conexion: sqlite3.Connection) -> str | None:
    """Devuelve `tipo_programa` solo si existe en la lista global.

    `clientes.tipo_programa` tiene una clave foránea contra `programas`, así
    que ahí no se puede escribir un nombre libre. Desde el 2026-08-03 la
    etiqueta de verdad del servicio vive en el ciclo
    (`programas_cliente.tipo_programa`), que sí es libre, y es la que se
    muestra en pantalla; esta columna se queda como puntero heredado y se
    deja intacta cuando el nombre nuevo no está en la lista.

    Se resolvió así, y no quitando la clave foránea, porque quitarla obliga a
    reconstruir la tabla `clientes` — de la que cuelgan las claves foráneas
    de historial, bonos y confirmaciones. Cambio pequeño y reversible frente
    a uno grande y arriesgado, que es la regla del proyecto."""
    if not tipo_programa:
        return None
    existe = conexion.execute("SELECT 1 FROM programas WHERE nombre = ?", (tipo_programa,)).fetchone()
    return tipo_programa if existe else None


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
        # Su bono en curso queda registrado ya, sin esperar a la primera
        # sesión: así la ficha lo enseña desde el alta. Sin fechas todavía —
        # no se inventa un inicio que aún no ha ocurrido.
        fila = conexion.execute("SELECT ciclo_bono FROM clientes WHERE nombre = ?", (nombre,)).fetchone()
        programa = conexion.execute(
            "SELECT tarifa, sesiones_totales FROM programas WHERE nombre = ?", (tipo_programa,)
        ).fetchone()
        conexion.execute(
            "INSERT INTO programas_cliente "
            "(cliente, ciclo_bono, tipo_programa, tarifa, sesiones_totales, pagado) "
            "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(cliente, ciclo_bono) DO NOTHING",
            (
                nombre, fila["ciclo_bono"], tipo_programa,
                programa["tarifa"] if programa else None,
                (programa["sesiones_totales"] if programa else 0) or 0,
                int(not pendiente_pago),
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
            # El puntero solo se cambia si el nombre existe en la lista
            # global; si es una etiqueta libre del cliente, se conserva el
            # que ya tenía (ver `_puntero_de_programa_valido`).
            puntero = _puntero_de_programa_valido(tipo_programa, conexion)
            if puntero is not None:
                _validar_sesiones_completadas(sesiones_completadas, tipo_programa, conexion)
            elif sesiones_completadas < 0:
                raise ValueError("Las sesiones completadas no pueden ser negativas")

            if estado is None:
                conexion.execute(
                    "UPDATE clientes SET nombre = ?, tipo_programa = COALESCE(?, tipo_programa), "
                    "sesiones_completadas = ?, pendiente_pago = ? WHERE nombre = ?",
                    (nuevo_nombre, puntero, sesiones_completadas, int(pendiente_pago), nombre),
                )
            else:
                validar_estado(estado)
                conexion.execute(
                    "UPDATE clientes SET nombre = ?, tipo_programa = COALESCE(?, tipo_programa), "
                    "sesiones_completadas = ?, pendiente_pago = ?, estado = ? WHERE nombre = ?",
                    (nuevo_nombre, puntero, sesiones_completadas, int(pendiente_pago), estado, nombre),
                )
            # La etiqueta que se ve en pantalla vive en el ciclo en curso.
            if tipo_programa:
                conexion.execute(
                    "UPDATE programas_cliente SET tipo_programa = ? "
                    "WHERE cliente = ? AND ciclo_bono = (SELECT ciclo_bono FROM clientes WHERE nombre = ?)",
                    (tipo_programa, nombre, nuevo_nombre),
                )
            if nuevo_nombre != nombre:
                conexion.execute(
                    "UPDATE historial_sesiones SET cliente = ? WHERE cliente = ?", (nuevo_nombre, nombre)
                )
                # Los bonos del cliente también apuntan a su nombre: si no se
                # renombran a la vez, quedarían huérfanos.
                conexion.execute(
                    "UPDATE programas_cliente SET cliente = ? WHERE cliente = ?", (nuevo_nombre, nombre)
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
        conexion.execute("DELETE FROM programas_cliente WHERE cliente = ?", (nombre,))
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
                    "(cliente, fecha, hora, tipo_programa, numero_sesion, sesiones_totales, tarifa, ciclo_bono) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        cliente,
                        entrada["fecha"],
                        # Las sesiones antiguas no tienen hora y se quedan sin
                        # ella: no se inventa (2026-08-02).
                        entrada.get("hora"),
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
            "SELECT id, fecha, hora, tipo_programa, numero_sesion, sesiones_totales, tarifa, ciclo_bono "
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
            # Las sesiones del bono se toman de SU ciclo, no de la lista
            # global (2026-08-03). Con condiciones propias por cliente, la
            # lista global puede decir otra cosa: un bono de 8 sesiones
            # calculado contra un programa global de 4 daba contadores
            # negativos ("-9 de 8 sesiones", visto al dibujar la ficha).
            fila = conexion.execute(
                "SELECT c.ciclo_bono, "
                "       CASE WHEN pc.cliente IS NULL THEN p.sesiones_totales ELSE pc.sesiones_totales END "
                "         AS sesiones_totales "
                "FROM clientes c "
                "LEFT JOIN programas p ON p.nombre = c.tipo_programa "
                "LEFT JOIN programas_cliente pc ON pc.cliente = c.nombre AND pc.ciclo_bono = c.ciclo_bono "
                "WHERE c.nombre = ?",
                (nombre,),
            ).fetchone()
            sesiones_totales = int(fila["sesiones_totales"] or 0)
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


def obtener_programas_cliente(nombre: str, ruta: Path = RUTA_POR_DEFECTO) -> list[dict]:
    """Los bonos concretos que ha tenido un cliente, del más reciente al más
    antiguo, cada uno con SUS sesiones (2026-08-02).

    Agrupa por `ciclo_bono`, no por nombre de programa: si alguien contrata
    tres veces seguidas el mismo bono, salen como tres bonos distintos y sus
    sesiones no se mezclan.

    La tarifa que se devuelve es la HISTÓRICA del bono, guardada cuando se
    contrató — cambiar la tarifa actual del cliente no altera lo que muestran
    los bonos ya cerrados."""
    with conectar(ruta) as conexion:
        ficha = conexion.execute(
            "SELECT c.ciclo_bono, c.tipo_programa, c.pendiente_pago, p.tarifa, p.sesiones_totales "
            "FROM clientes c LEFT JOIN programas p ON p.nombre = c.tipo_programa "
            "WHERE c.nombre = ?",
            (nombre,),
        ).fetchone()
        if ficha is None:
            return []
        ciclo_actual = ficha["ciclo_bono"]

        bonos = conexion.execute(
            "SELECT ciclo_bono, tipo_programa, tarifa, sesiones_totales, fecha_inicio, fecha_fin, pagado, "
            "       COALESCE(modalidad, 'bono') AS modalidad, precio_total, cuota_mensual, "
            "       sesiones_referencia, anio, mes "
            "FROM programas_cliente WHERE cliente = ? ORDER BY ciclo_bono DESC",
            (nombre,),
        ).fetchall()

        sesiones = conexion.execute(
            "SELECT id, ciclo_bono, fecha, hora, numero_sesion, sesiones_totales, tipo_programa, tarifa "
            "FROM historial_sesiones WHERE cliente = ? ORDER BY fecha DESC, id DESC",
            (nombre,),
        ).fetchall()

    por_ciclo: dict[int, list[dict]] = {}
    for sesion in sesiones:
        por_ciclo.setdefault(sesion["ciclo_bono"], []).append(dict(sesion))

    resultado = []
    for bono in bonos:
        datos = dict(bono)
        datos["es_actual"] = bono["ciclo_bono"] == ciclo_actual
        datos["sesiones"] = por_ciclo.get(bono["ciclo_bono"], [])
        resultado.append(datos)

    if not any(bono["es_actual"] for bono in resultado):
        sesiones_actuales = por_ciclo.get(ciclo_actual, [])
        resultado.insert(0, {
            "ciclo_bono": ciclo_actual,
            "tipo_programa": ficha["tipo_programa"],
            "tarifa": ficha["tarifa"],
            "sesiones_totales": ficha["sesiones_totales"] or 0,
            "fecha_inicio": sesiones_actuales[-1]["fecha"] if sesiones_actuales else None,
            "fecha_fin": None,
            "pagado": int(not ficha["pendiente_pago"]),
            "modalidad": MODALIDAD_POR_DEFECTO,
            "precio_total": None,
            "cuota_mensual": None,
            "sesiones_referencia": None,
            "anio": None,
            "mes": None,
            "es_actual": True,
            "sesiones": sesiones_actuales,
        })
    return resultado


def obtener_ciclo_actual(
    cliente: str, conexion: sqlite3.Connection | None = None, ruta: Path = RUTA_POR_DEFECTO
) -> dict | None:
    """El ciclo en curso de un cliente, con sus condiciones económicas.

    Es la respuesta a "¿qué tiene contratado ahora mismo y en qué
    condiciones?", y la fuente de verdad para firmar una sesión: la
    modalidad decide si se consume saldo, si la sesión lleva importe y si
    hay que renovar."""

    def _hacer(conexion: sqlite3.Connection) -> dict | None:
        fila = conexion.execute(
            "SELECT pc.*, c.pendiente_pago, c.estado, c.sesiones_completadas, "
            "       c.ciclo_bono AS ciclo_del_cliente, c.tipo_programa AS programa_del_cliente, "
            "       p.tarifa AS tarifa_global, p.sesiones_totales AS totales_global "
            "FROM clientes c "
            "LEFT JOIN programas_cliente pc ON pc.cliente = c.nombre AND pc.ciclo_bono = c.ciclo_bono "
            "LEFT JOIN programas p ON p.nombre = c.tipo_programa "
            "WHERE c.nombre = ?",
            (cliente,),
        ).fetchone()
        if fila is None:
            return None

        datos = dict(fila)
        if datos.get("cliente") is None:
            # El cliente existe pero le falta la ficha de su ciclo en curso
            # (dado de alta antes de que existieran, o creado a mano). Se
            # compone al vuelo desde la lista global para que pueda seguir
            # firmando con normalidad — leer nunca escribe.
            datos.update({
                "cliente": cliente,
                "ciclo_bono": datos["ciclo_del_cliente"],
                "tipo_programa": datos["programa_del_cliente"],
                "modalidad": MODALIDAD_POR_DEFECTO,
                "tarifa": datos["tarifa_global"],
                "sesiones_totales": datos["totales_global"],
                "precio_total": None,
                "cuota_mensual": None,
                "sesiones_referencia": None,
                "anio": None,
                "mes": None,
                "fecha_inicio": None,
                "fecha_fin": None,
                "pagado": int(not datos["pendiente_pago"]),
            })

        datos["modalidad"] = datos.get("modalidad") or MODALIDAD_POR_DEFECTO
        return datos

    if conexion is not None:
        return _hacer(conexion)
    with conectar(ruta) as conexion:
        return _hacer(conexion)


def asegurar_ciclo_mensual(
    cliente: str,
    anio: int,
    mes: int,
    conexion: sqlite3.Connection | None = None,
    ruta: Path = RUTA_POR_DEFECTO,
) -> dict:
    """Se asegura de que un cliente mensual (mensualidad o cuenta) tiene
    abierto el ciclo del mes que se le indica. Si ya lo tiene, no hace nada.

    Es la pieza que hace que la mensualidad se renueve por CALENDARIO y no
    por número de sesiones: al llegar agosto se cierra el ciclo de julio
    (con sus sesiones, su cuota y su estado de pago congelados) y se abre el
    de agosto, en cero y pendiente de pago.

    **Segura de llamar tantas veces como haga falta.** No lo garantiza este
    código, sino la base de datos: la clave primaria de `cargos_mensuales`
    es (cliente, año, mes, concepto), así que aunque diez peticiones a la
    vez intenten cobrar agosto, solo cabe una fila. Por eso se puede llamar
    al abrir la ficha, al firmar y al arrancar la app sin miedo a duplicar
    la cuota.

    Devuelve {"creado": bool, "ciclo": int} — `creado` dice si ha abierto
    uno nuevo, para poder contarlo o enseñarlo.
    """

    def _hacer(conexion: sqlite3.Connection) -> dict:
        actual = obtener_ciclo_actual(cliente, conexion=conexion)
        if actual is None or not es_mensual(actual["modalidad"]):
            # Un bono no se renueva por calendario: se renueva al agotarse.
            return {"creado": False, "ciclo": actual["ciclo_bono"] if actual else None}

        if actual["anio"] == anio and actual["mes"] == mes:
            return {"creado": False, "ciclo": actual["ciclo_bono"]}

        if (actual["anio"], actual["mes"]) > (anio, mes):
            # Nunca se retrocede: si el ciclo en curso es de un mes
            # posterior, alguien está consultando el pasado. No se toca.
            return {"creado": False, "ciclo": actual["ciclo_bono"]}

        ciclo_anterior = actual["ciclo_bono"]
        ciclo_nuevo = ciclo_anterior + 1

        # El mes que se va queda congelado tal cual quedó: su cuota, sus
        # sesiones, su precio efectivo y su estado de pago. No se recalcula
        # nada de lo anterior.
        ultima = conexion.execute(
            "SELECT MAX(fecha) AS f FROM historial_sesiones WHERE cliente = ? AND ciclo_bono = ?",
            (cliente, ciclo_anterior),
        ).fetchone()["f"]
        conexion.execute(
            "UPDATE programas_cliente SET fecha_fin = COALESCE(fecha_fin, ?), pagado = ? "
            "WHERE cliente = ? AND ciclo_bono = ?",
            (ultima, int(not actual["pendiente_pago"]), cliente, ciclo_anterior),
        )

        conexion.execute(
            "INSERT INTO programas_cliente "
            "(cliente, ciclo_bono, tipo_programa, modalidad, tarifa, sesiones_totales, "
            " precio_total, cuota_mensual, sesiones_referencia, anio, mes, fecha_inicio, fecha_fin, pagado) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0) "
            "ON CONFLICT(cliente, ciclo_bono) DO NOTHING",
            (
                cliente, ciclo_nuevo, actual["tipo_programa"], actual["modalidad"],
                actual["tarifa"], actual["sesiones_totales"] or 0, actual["precio_total"],
                actual["cuota_mensual"], actual["sesiones_referencia"], anio, mes,
            ),
        )
        conexion.execute("UPDATE clientes SET ciclo_bono = ? WHERE nombre = ?", (ciclo_nuevo, cliente))
        # El mes nuevo empieza a deberse: todavía no se ha cobrado.
        conexion.execute("UPDATE clientes SET pendiente_pago = 1 WHERE nombre = ?", (cliente,))

        _cobrar_mes_si_procede(cliente, ciclo_nuevo, anio, mes, conexion)
        return {"creado": True, "ciclo": ciclo_nuevo}

    if conexion is not None:
        return _hacer(conexion)
    with conectar(ruta) as conexion:
        resultado = _hacer(conexion)
        conexion.commit()
        return resultado


def _cobrar_mes_si_procede(
    cliente: str, ciclo: int, anio: int, mes: int, conexion: sqlite3.Connection
) -> None:
    """Registra la cuota del mes de una mensualidad — una sola vez.

    Solo las mensualidades generan cargo: una cuenta de cliente factura por
    las sesiones que se firmen, no por adelantado.

    Un cliente pausado o cancelado NO genera cuota: cobrar automáticamente a
    quien ha dejado de entrenar sería inventar ingresos. (Decisión prudente
    de Claude, 2026-08-03, pendiente de que Fernando la confirme.)"""
    fila = conexion.execute(
        "SELECT pc.modalidad, pc.cuota_mensual, c.estado FROM programas_cliente pc "
        "JOIN clientes c ON c.nombre = pc.cliente "
        "WHERE pc.cliente = ? AND pc.ciclo_bono = ?",
        (cliente, ciclo),
    ).fetchone()
    if fila is None:
        return
    if (fila["modalidad"] or MODALIDAD_POR_DEFECTO) != "mensualidad":
        return
    if not fila["cuota_mensual"]:
        return
    if (fila["estado"] or ESTADO_POR_DEFECTO) != "activo":
        return

    # `DO NOTHING` sobre la clave (cliente, año, mes, concepto): es la base
    # de datos la que impide cobrar dos veces el mismo mes.
    conexion.execute(
        "INSERT INTO cargos_mensuales (cliente, anio, mes, concepto, ciclo, importe, creado, pagado) "
        "VALUES (?, ?, ?, 'mensualidad', ?, ?, ?, 0) "
        "ON CONFLICT(cliente, anio, mes, concepto) DO NOTHING",
        (cliente, anio, mes, ciclo, fila["cuota_mensual"], date.today().isoformat()),
    )


def asegurar_ciclos_mensuales(
    anio: int, mes: int, ruta: Path = RUTA_POR_DEFECTO
) -> int:
    """Pone al día a todos los clientes mensuales de golpe. Se llama al
    arrancar la web y al abrir la lista de clientes, que es la pantalla que
    Fernando abre siempre.

    Deliberadamente NO se llama desde Economía: consultar una pantalla no
    debe escribir en la base de datos. Así una consulta nunca puede crear ni
    duplicar nada, que es la garantía más fácil de mantener.

    Devuelve cuántos ciclos nuevos se han abierto."""
    if not ruta.exists():
        return 0

    creados = 0
    with conectar(ruta) as conexion:
        mensuales = conexion.execute(
            "SELECT c.nombre FROM clientes c "
            "JOIN programas_cliente pc ON pc.cliente = c.nombre AND pc.ciclo_bono = c.ciclo_bono "
            "WHERE pc.modalidad IN ('mensualidad', 'cuenta')"
        ).fetchall()
        for fila in mensuales:
            if asegurar_ciclo_mensual(fila["nombre"], anio, mes, conexion=conexion)["creado"]:
                creados += 1
        # También hay que cobrar el mes en curso de quien ya lo tiene abierto
        # pero todavía no tiene su cargo (p. ej. recién configurado a
        # mensualidad a mitad de mes).
        for fila in mensuales:
            actual = obtener_ciclo_actual(fila["nombre"], conexion=conexion)
            if actual and actual["anio"] == anio and actual["mes"] == mes:
                _cobrar_mes_si_procede(fila["nombre"], actual["ciclo_bono"], anio, mes, conexion)
        conexion.commit()

    return creados


def registrar_programa_cliente(
    cliente: str,
    ciclo_bono: int,
    tipo_programa: str,
    tarifa: float | None,
    sesiones_totales: int,
    fecha_inicio: str | None = None,
    conexion: sqlite3.Connection | None = None,
    ruta: Path = RUTA_POR_DEFECTO,
) -> None:
    """Da de alta el bono de un cliente si todavía no existe (al crearlo o al
    renovar). No pisa uno ya guardado: sus fechas y su tarifa histórica se
    conservan.

    `conexion`: para formar parte de la misma transacción atómica que la
    firma de la sesión que provoca la renovación."""

    def _hacer(conexion: sqlite3.Connection) -> None:
        conexion.execute(
            "INSERT INTO programas_cliente "
            "(cliente, ciclo_bono, tipo_programa, tarifa, sesiones_totales, fecha_inicio, fecha_fin, pagado) "
            "VALUES (?, ?, ?, ?, ?, ?, NULL, 0) "
            # Si el bono ya existe no se toca nada, salvo estrenar su fecha de
            # inicio: al renovar se crea sin fecha (todavía no se ha
            # entrenado), y es la primera sesión la que la estrena.
            "ON CONFLICT(cliente, ciclo_bono) DO UPDATE SET "
            "  fecha_inicio = COALESCE(programas_cliente.fecha_inicio, excluded.fecha_inicio)",
            (cliente, ciclo_bono, tipo_programa, tarifa, sesiones_totales, fecha_inicio),
        )

    if conexion is not None:
        _hacer(conexion)
    else:
        with conectar(ruta) as conexion:
            _hacer(conexion)


def marcar_pago_del_ciclo(
    cliente: str, pagado: bool, ciclo: int | None = None, ruta: Path = RUTA_POR_DEFECTO
) -> dict:
    """Cambia el estado de COBRO de un servicio, y nada más.

    `ciclo`: cuál. Si no se indica, el que esté en curso. **Se puede marcar
    cualquier ciclo, también uno ya cerrado** (2026-08-04): en el negocio
    real la gente paga DESPUÉS de terminar el periodo — una cuenta de
    cliente se cobra al acabar el mes, y un bono puede quedar a deber
    después de agotarse. Congelar el estado de cobro al cerrar el ciclo
    dejaba esas deudas sin forma de saldarse.

    Lo que NO toca, en ningún caso: sesiones, horas, historial,
    facturación ni precio medio. Cobrar más tarde no hace que el trabajo
    se haya hecho más tarde, ni cambia lo que costó.

    Escribe a la vez, en una sola transacción, en todos los sitios donde
    vive ese estado —el ciclo, el cargo del mes si es una mensualidad, y la
    ficha del cliente si el ciclo es el que está en curso— para que no
    puedan contradecirse. La ficha del cliente NO se toca al marcar un ciclo
    antiguo: su "pendiente de pago" habla del servicio de ahora.

    Devuelve {"ciclo": n, "es_actual": bool, "pagado": bool}.
    """
    with conectar(ruta) as conexion:
        conexion.execute("BEGIN")
        try:
            fila = conexion.execute(
                "SELECT ciclo_bono FROM clientes WHERE nombre = ?", (cliente,)
            ).fetchone()
            if fila is None:
                raise ValueError(f"No existe el cliente '{cliente}'")

            ciclo_actual = fila["ciclo_bono"]
            objetivo = ciclo_actual if ciclo is None else int(ciclo)

            existe = conexion.execute(
                "SELECT 1 FROM programas_cliente WHERE cliente = ? AND ciclo_bono = ?",
                (cliente, objetivo),
            ).fetchone()
            if not existe and objetivo != ciclo_actual:
                raise ValueError(f"'{cliente}' no tiene ningún servicio con el número {objetivo}")

            conexion.execute(
                "UPDATE programas_cliente SET pagado = ? WHERE cliente = ? AND ciclo_bono = ?",
                (int(pagado), cliente, objetivo),
            )
            # Si ese ciclo era una mensualidad, su cuota del mes queda
            # marcada igual: es el cargo concreto que se cobra o se debe.
            conexion.execute(
                "UPDATE cargos_mensuales SET pagado = ? WHERE cliente = ? AND ciclo = ?",
                (int(pagado), cliente, objetivo),
            )
            # `clientes.pendiente_pago` describe el servicio EN CURSO, así que
            # solo se mueve cuando se está marcando ese.
            if objetivo == ciclo_actual:
                conexion.execute(
                    "UPDATE clientes SET pendiente_pago = ? WHERE nombre = ?",
                    (int(not pagado), cliente),
                )

            conexion.commit()
            return {"ciclo": objetivo, "es_actual": objetivo == ciclo_actual, "pagado": bool(pagado)}
        except Exception:
            conexion.rollback()
            raise


def deuda_pendiente(cliente: str, ruta: Path = RUTA_POR_DEFECTO) -> list[dict]:
    """Los ciclos de un cliente que están marcados como NO cobrados, del más
    reciente al más antiguo. Un ciclo sin marcar (`pagado` nulo) no cuenta
    como deuda: de los servicios anteriores a esta versión nunca se registró
    el pago y no se va a suponer."""
    with conectar(ruta) as conexion:
        filas = conexion.execute(
            "SELECT ciclo_bono, tipo_programa, COALESCE(modalidad, 'bono') AS modalidad, "
            "       anio, mes, fecha_inicio, fecha_fin "
            "FROM programas_cliente WHERE cliente = ? AND pagado = 0 "
            "ORDER BY ciclo_bono DESC",
            (cliente,),
        ).fetchall()
    return [dict(fila) for fila in filas]


def configurar_servicio(
    cliente: str,
    modalidad: str,
    *,
    nombre_servicio: str | None = None,
    sesiones_totales=None,
    precio_total=None,
    cuota_mensual=None,
    tarifa=None,
    sesiones_referencia=None,
    pendiente_pago: bool | None = None,
    hoy: date | None = None,
    ruta: Path = RUTA_POR_DEFECTO,
) -> dict:
    """Configura el servicio de un cliente: su modalidad y sus condiciones.

    Es lo que hay detrás de «Editar programa». Dos comportamientos muy
    distintos según lo que se cambie:

    **Si la modalidad NO cambia**, se corrigen las condiciones del ciclo en
    curso ahí mismo. Es una corrección, no un servicio nuevo.

    **Si la modalidad SÍ cambia**, el ciclo actual se CIERRA y se abre uno
    nuevo. Nunca se transforma un ciclo ya empezado: las sesiones ya hechas
    se quedan donde están, con las condiciones con las que se hicieron, y la
    economía pasada no se recalcula. Un bono a medias no se convierte en una
    mensualidad — se cierra como bono y empieza una mensualidad limpia.

    Todo ocurre dentro de una única transacción: o se guarda entero o no se
    guarda nada.
    """
    validar_modalidad(modalidad)
    condiciones = validar_condiciones(
        modalidad,
        sesiones_totales=sesiones_totales,
        precio_total=precio_total,
        cuota_mensual=cuota_mensual,
        tarifa=tarifa,
        sesiones_referencia=sesiones_referencia,
    )
    hoy = hoy or date.today()

    with conectar(ruta) as conexion:
        conexion.isolation_level = None
        conexion.execute("BEGIN IMMEDIATE")
        try:
            actual = obtener_ciclo_actual(cliente, conexion=conexion)
            if actual is None:
                raise ValueError(f"No existe el cliente '{cliente}'")

            etiqueta = (nombre_servicio or "").strip() or actual["tipo_programa"] or ETIQUETAS_MODALIDAD[modalidad]
            cambia_modalidad = actual["modalidad"] != modalidad
            debe = actual["pendiente_pago"] if pendiente_pago is None else pendiente_pago

            if cambia_modalidad:
                ciclo_nuevo = actual["ciclo_bono"] + 1
                ultima = conexion.execute(
                    "SELECT MAX(fecha) AS f FROM historial_sesiones WHERE cliente = ? AND ciclo_bono = ?",
                    (cliente, actual["ciclo_bono"]),
                ).fetchone()["f"]
                # El ciclo que se va queda cerrado tal cual estaba. Ni sus
                # sesiones ni su economía se tocan.
                conexion.execute(
                    "UPDATE programas_cliente SET fecha_fin = COALESCE(fecha_fin, ?), pagado = ? "
                    "WHERE cliente = ? AND ciclo_bono = ?",
                    (ultima or hoy.isoformat(), int(not actual["pendiente_pago"]),
                     cliente, actual["ciclo_bono"]),
                )
                conexion.execute(
                    "INSERT INTO programas_cliente "
                    "(cliente, ciclo_bono, tipo_programa, modalidad, tarifa, sesiones_totales, "
                    " precio_total, cuota_mensual, sesiones_referencia, anio, mes, fecha_inicio, fecha_fin, pagado) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)",
                    (
                        cliente, ciclo_nuevo, etiqueta, modalidad,
                        condiciones["tarifa"], condiciones["sesiones_totales"] or 0,
                        condiciones["precio_total"], condiciones["cuota_mensual"],
                        condiciones["sesiones_referencia"],
                        hoy.year if es_mensual(modalidad) else None,
                        hoy.month if es_mensual(modalidad) else None,
                        int(not debe),
                    ),
                )
                conexion.execute(
                    "UPDATE clientes SET ciclo_bono = ?, tipo_programa = COALESCE(?, tipo_programa), "
                    "sesiones_completadas = 0, pendiente_pago = ? WHERE nombre = ?",
                    (ciclo_nuevo, _puntero_de_programa_valido(etiqueta, conexion), int(debe), cliente),
                )
                _cobrar_mes_si_procede(cliente, ciclo_nuevo, hoy.year, hoy.month, conexion)
                resultado = {"ciclo_anterior": actual["ciclo_bono"], "ciclo": ciclo_nuevo, "cerrado": True}
            else:
                # INSERT ... ON CONFLICT, no UPDATE a secas: un cliente dado
                # de alta antes de que existieran las fichas de ciclo no
                # tiene fila que actualizar, y un UPDATE se quedaría en nada
                # sin avisar (encontrado al dibujar la ficha, 2026-08-03).
                conexion.execute(
                    "INSERT INTO programas_cliente "
                    "(cliente, ciclo_bono, tipo_programa, modalidad, tarifa, sesiones_totales, "
                    " precio_total, cuota_mensual, sesiones_referencia, anio, mes, pagado) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                    "ON CONFLICT(cliente, ciclo_bono) DO UPDATE SET "
                    "  tipo_programa = excluded.tipo_programa, modalidad = excluded.modalidad, "
                    "  tarifa = excluded.tarifa, sesiones_totales = excluded.sesiones_totales, "
                    "  precio_total = excluded.precio_total, cuota_mensual = excluded.cuota_mensual, "
                    "  sesiones_referencia = excluded.sesiones_referencia, "
                    "  anio = COALESCE(programas_cliente.anio, excluded.anio), "
                    "  mes = COALESCE(programas_cliente.mes, excluded.mes)",
                    (
                        cliente, actual["ciclo_bono"], etiqueta, modalidad,
                        condiciones["tarifa"], condiciones["sesiones_totales"] or 0,
                        condiciones["precio_total"], condiciones["cuota_mensual"],
                        condiciones["sesiones_referencia"],
                        hoy.year if es_mensual(modalidad) else None,
                        hoy.month if es_mensual(modalidad) else None,
                        int(not debe),
                    ),
                )
                conexion.execute(
                    "UPDATE clientes SET tipo_programa = COALESCE(?, tipo_programa), "
                    "pendiente_pago = ? WHERE nombre = ?",
                    (_puntero_de_programa_valido(etiqueta, conexion), int(debe), cliente),
                )
                _cobrar_mes_si_procede(cliente, actual["ciclo_bono"], hoy.year, hoy.month, conexion)
                resultado = {"ciclo_anterior": None, "ciclo": actual["ciclo_bono"], "cerrado": False}

            conexion.commit()
            return resultado
        except Exception:
            conexion.rollback()
            raise


def cerrar_programa_cliente(
    cliente: str,
    ciclo_bono: int,
    fecha_fin: str,
    pagado: bool,
    conexion: sqlite3.Connection | None = None,
    ruta: Path = RUTA_POR_DEFECTO,
) -> None:
    """Marca un bono como terminado, guardando cuándo acabó y si quedó
    pagado. Se llama al renovar: es el único momento en que se sabe con
    certeza cómo quedó el bono que se cierra."""

    def _hacer(conexion: sqlite3.Connection) -> None:
        conexion.execute(
            "UPDATE programas_cliente SET fecha_fin = ?, pagado = ? WHERE cliente = ? AND ciclo_bono = ?",
            (fecha_fin, int(pagado), cliente, ciclo_bono),
        )

    if conexion is not None:
        _hacer(conexion)
    else:
        with conectar(ruta) as conexion:
            _hacer(conexion)
