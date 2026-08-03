"""Registro de asistencia en el momento — decisión de Fernando del
2026-07-22: en vez de perseguir una automatización con Calendar que no se
podía verificar, cada sesión de PT se confirma con un toque nada más
terminarla (desde el móvil de Fernando), y las clases de grupo (CrossFit
Lidomare/Kids, que no son de un cliente concreto) se cuentan con un botón
aparte. Sustituye a Calendar como fuente del día a día — Calendar sigue
sirviendo para planificar, pero ya no hace falta leerlo para contar
sesiones.

Sprint de integridad (2026-07-28): cada operación de negocio (firmar,
editar, borrar, clase de grupo) es ahora una única transacción atómica
(`basedatos.transaccion`) — antes actualizaba por separado el bono, el
historial y la economía en 3-4 guardados independientes; un fallo a mitad
podía dejar unos guardados y otros no. La comprobación de sincronización
(avisos) sigue corriendo DESPUÉS de que la transacción se confirme, como un
chequeo posterior de solo lectura — no necesita estar dentro de la misma
transacción."""

from datetime import date, datetime
from pathlib import Path

from avisos import registrar_aviso
from basedatos import RUTA_POR_DEFECTO, transaccion
from calendar_integration.semana import get_week_range
from clientes.repositorio import (
    aplicar_actualizaciones,
    asegurar_ciclo_mensual,
    cerrar_programa_cliente,
    editar_historial,
    eliminar_cliente,
    eliminar_historial,
    marcar_pendiente_pago,
    obtener_ciclo_actual,
    obtener_historial,
    registrar_historial,
    registrar_programa_cliente,
)
from economia.calculo import TARIFA_CROSSFIT_LIDOMARE
from economia.registro import (
    obtener_desglose_semana,
    obtener_semana,
    registrar_semana,
    verificar_sincronizacion_semana,
)
from programas.logica import ActualizacionPrograma
from programas.procesar import procesar_una_sesion
from servicios.modalidades import (
    BONO,
    CUENTA,
    MENSUALIDAD,
    consume_sesiones,
    tarifa_de_la_sesion,
)
from zona_horaria import ahora_negocio, hoy_negocio


def _sumar_a_semana(fecha: date, tarifa: float | None, sesiones_extra: int, kids_extra: int, conexion) -> None:
    """Suma (o resta) sesiones a la economía de la semana que contiene
    `fecha`, dentro de la conexión/transacción que le pasa quien llama —
    ya no abre sus propias conexiones sueltas (sprint de integridad,
    2026-07-28).

    Una sesión SIN tarifa (la de una mensualidad) no aporta dinero, pero sí
    una hora trabajada: se cuenta en `horas_sin_importe` en vez de en el
    desglose por tarifa (corrección H-01, 2026-08-03). Antes no se contaba en
    ningún sitio y la semana perdía esas horas."""
    inicio, fin = get_week_range(datetime.combine(fecha, datetime.min.time()))
    clave = inicio.date().isoformat()

    desglose = obtener_desglose_semana(clave, conexion=conexion)
    if tarifa is not None:
        entrada = desglose.setdefault(tarifa, {"sesiones": 0, "facturacion": 0.0})
        entrada["sesiones"] += sesiones_extra
        entrada["facturacion"] += sesiones_extra * tarifa

    semana_actual = obtener_semana(clave, conexion=conexion)
    sesiones_kids = (semana_actual["sesiones_kids"] if semana_actual else 0) + kids_extra

    horas_sin_importe = semana_actual["horas_sin_importe"] if semana_actual else 0
    if tarifa is None and sesiones_extra:
        # Solo una sesión de PT sin importe. Una clase de grupo llega aquí
        # con `sesiones_extra = 0` y su propio contador, así que no entra.
        horas_sin_importe += sesiones_extra

    registrar_semana(
        inicio.date(), fin.date(), desglose, sesiones_kids,
        conexion=conexion, horas_sin_importe=horas_sin_importe,
    )


def _bloquear_si_hay_ciclos_posteriores(conexion, entrada_id: int, accion: str) -> None:
    """Impide modificar o borrar una sesión de un bono ya cerrado cuando el
    cliente tiene sesiones de un bono POSTERIOR (segunda auditoría,
    2026-07-30).

    Por qué se bloquea en vez de recalcular: cambiar una sesión de un ciclo
    antiguo (p. ej. bajar la sesión 12 a la 11) obligaría a renumerar todas
    las sesiones de todos los bonos siguientes y a rehacer sus renovaciones
    y su economía. Es exactamente el tipo de recálculo masivo y silencioso
    que este proyecto evita: para la v1 se prioriza seguridad y simplicidad,
    con un mensaje claro de qué hacer. Si más adelante hace falta, se
    diseñará aparte y se presentará antes de construirlo."""
    fila = conexion.execute(
        "SELECT cliente, ciclo_bono, numero_sesion FROM historial_sesiones WHERE id = ?", (entrada_id,)
    ).fetchone()
    if fila is None:
        raise ValueError("Esa entrada del historial ya no existe")

    posteriores = conexion.execute(
        "SELECT COUNT(*) AS n FROM historial_sesiones WHERE cliente = ? AND ciclo_bono > ?",
        (fila["cliente"], fila["ciclo_bono"]),
    ).fetchone()["n"]

    if posteriores:
        raise ValueError(
            f"No se puede {accion} la sesión {fila['numero_sesion']} de '{fila['cliente']}': pertenece a un "
            f"bono ya cerrado y después hay {posteriores} sesiones de bonos posteriores que dependen de ella. "
            f"Corrige primero las sesiones del bono actual, de la más reciente hacia atrás."
        )


def _comprobar_sincronizacion(inicio: date, fin: date, ruta: Path = RUTA_POR_DEFECTO) -> None:
    """Tras confirmarse la transacción de una operación que toca la
    economía de una semana, comprueba que el historial y `desglose` siguen
    coincidiendo — así, si algo se desincroniza, Fernando se entera el
    mismo día en Avisos en vez de detectarlo semanas después. Se ejecuta
    DESPUÉS de que la transacción se confirme (con conexiones nuevas, de
    solo lectura) — no es parte de la operación atómica en sí, es una
    comprobación posterior (sprint de integridad, 2026-07-28)."""
    for detalle in verificar_sincronizacion_semana(inicio, fin, ruta):
        registrar_aviso(hoy_negocio().isoformat(), "discrepancia_economica", detalle, ruta)


def registrar_sesion_pt(
    nombre: str, fecha: date | None = None, clave_idempotencia: str | None = None, ruta: Path = RUTA_POR_DEFECTO
) -> dict:
    """Confirma una sesión de PT de un cliente concreto: descuenta del
    bono (con renovación automática si tocaba), guarda la fecha en su
    historial, y suma la sesión a la economía de esta semana — todo en una
    única transacción atómica.

    Un cliente puede tener varias sesiones firmadas el mismo día si hace
    falta (decisión de Fernando, 2026-07-24). El botón "Firmar sesión" del
    navegador se desactiva nada más pulsarlo para evitar un doble toque
    accidental, y además `clave_idempotencia` (un valor de un solo uso que
    genera cada carga de la página) impide que una misma petición se
    guarde dos veces por un reintento de red o dos pestañas abiertas —
    sprint de integridad, 2026-07-28. Volver a cargar la página genera una
    clave nueva, así que una segunda sesión real sí se puede firmar.

    **Todo ocurre dentro de una única transacción `BEGIN IMMEDIATE`**,
    incluida la LECTURA del estado del cliente y el cálculo de qué número de
    sesión le toca (segunda auditoría, 2026-07-30). Antes, el programa y la
    tarifa se leían fuera de la transacción: dos firmas simultáneas del
    mismo cliente (dos pestañas, o Fernando y el móvil a la vez) podían leer
    las dos el mismo estado y calcular las dos el MISMO número de sesión,
    dejando dos filas con el mismo número y el contador avanzando solo una
    posición. `BEGIN IMMEDIATE` coge el bloqueo de escritura antes de leer,
    así que la segunda firma espera y ve el estado ya actualizado."""
    fecha = fecha or hoy_negocio()
    inicio_semana, fin_semana = get_week_range(datetime.combine(fecha, datetime.min.time()))

    with transaccion(ruta, inmediata=True) as conexion:
        # Si es un cliente mensual y ha cambiado el mes, primero se abre su
        # ciclo nuevo — DENTRO de la misma transacción que la firma, para que
        # no pueda quedarse a medias (ciclo abierto pero sesión sin guardar,
        # o al revés).
        asegurar_ciclo_mensual(nombre, fecha.year, fecha.month, conexion=conexion)

        # Condiciones del ciclo en curso leídas DENTRO de la transacción
        # bloqueante: son la base del cálculo de la siguiente sesión, así que
        # no pueden leerse antes de coger el bloqueo.
        ciclo = obtener_ciclo_actual(nombre, conexion=conexion)
        if ciclo is None:
            raise ValueError(f"'{nombre}' no tiene un servicio asignado")

        modalidad = ciclo["modalidad"]
        ciclo_bono = ciclo["ciclo_bono"]
        etiqueta_servicio = ciclo["tipo_programa"]

        if modalidad == BONO:
            if ciclo["sesiones_totales"] is None or ciclo["tarifa"] is None:
                raise ValueError(
                    f"A '{nombre}' le faltan datos del bono por rellenar — revísalo en Editar programa"
                )
        elif modalidad == CUENTA and ciclo["tarifa"] is None:
            raise ValueError(
                f"A '{nombre}' le falta el precio por sesión — revísalo en Editar programa"
            )
        elif modalidad == MENSUALIDAD and not ciclo["cuota_mensual"]:
            raise ValueError(
                f"A '{nombre}' le falta la cuota mensual — revísalo en Editar programa"
            )

        # Lo que esta sesión aporta a la economía. En una mensualidad es
        # `None`: la cuota del mes ya está registrada aparte, así que sumar
        # también cada sesión sería cobrar dos veces. La sesión se guarda
        # igual y sigue contando como hora trabajada.
        tarifa = tarifa_de_la_sesion(modalidad, ciclo["tarifa"])

        if consume_sesiones(modalidad):
            programa = {
                "sesiones_restantes": ciclo["sesiones_totales"] - ciclo["sesiones_completadas"],
                "sesiones_totales": ciclo["sesiones_totales"],
                "pendiente_pago": bool(ciclo["pendiente_pago"]),
                "tipo_programa": etiqueta_servicio,
            }
            paso, numero_sesion = procesar_una_sesion(programa)
        else:
            # Mensualidad y cuenta de cliente: no hay saldo que gastar ni
            # renovación que disparar. La sesión simplemente es la siguiente
            # de este mes.
            hechas = conexion.execute(
                "SELECT COUNT(*) AS n FROM historial_sesiones WHERE cliente = ? AND ciclo_bono = ?",
                (nombre, ciclo_bono),
            ).fetchone()["n"]
            numero_sesion = hechas + 1
            programa = {
                "sesiones_totales": 0,  # 0 = sin tope
                "pendiente_pago": bool(ciclo["pendiente_pago"]),
                "tipo_programa": etiqueta_servicio,
            }
            paso = ActualizacionPrograma(
                sesiones_restantes=0, renovado=False,
                pendiente_pago=bool(ciclo["pendiente_pago"]), aviso_ultima_sesion=False,
            )

        if clave_idempotencia is not None:
            ya_procesada = conexion.execute(
                "SELECT 1 FROM firmas_idempotencia WHERE clave = ?", (clave_idempotencia,)
            ).fetchone()
            if ya_procesada:
                # Ya se guardó esta misma petición antes (reintento de red,
                # doble pestaña...) — no se repite nada, se devuelve el
                # estado actual sin volver a tocar bono/historial/economía.
                cliente_actual = conexion.execute(
                    "SELECT sesiones_completadas FROM clientes WHERE nombre = ?", (nombre,)
                ).fetchone()
                return {
                    "numero_sesion": cliente_actual["sesiones_completadas"] if cliente_actual else numero_sesion,
                    "sesiones_totales": programa["sesiones_totales"],
                    "renovado": False,
                    "aviso_ultima_sesion": False,
                    "duplicado": True,
                    "modalidad": modalidad,
                    "anio": fecha.year,
                    "mes": fecha.month,
                }
            conexion.execute(
                "INSERT INTO firmas_idempotencia (clave, creado) VALUES (?, ?)",
                (clave_idempotencia, hoy_negocio().isoformat()),
            )

        if consume_sesiones(modalidad):
            # Solo un bono descuenta saldo y puede renovar. Una mensualidad
            # o una cuenta no tienen nada que gastar.
            aplicar_actualizaciones({nombre: paso}, conexion=conexion)
            # El bono en curso debe existir como ficha antes de colgarle
            # sesiones (un cliente recién dado de alta aún no la tiene).
            registrar_programa_cliente(
                nombre, ciclo_bono, programa["tipo_programa"], ciclo["tarifa"],
                programa["sesiones_totales"], fecha.isoformat(), conexion=conexion,
            )
        else:
            # La ficha del ciclo mensual ya existe (la creó
            # `asegurar_ciclo_mensual` o la configuración del servicio);
            # solo estrena su fecha de inicio con la primera sesión.
            conexion.execute(
                "UPDATE programas_cliente SET fecha_inicio = COALESCE(fecha_inicio, ?) "
                "WHERE cliente = ? AND ciclo_bono = ?",
                (fecha.isoformat(), nombre, ciclo_bono),
            )

        registrar_historial(
            {
                nombre: [
                    {
                        "fecha": fecha.isoformat(),
                        "hora": ahora_negocio().strftime("%H:%M"),
                        "numero_sesion": numero_sesion,
                        "sesiones_totales": programa["sesiones_totales"],
                        "tipo_programa": programa["tipo_programa"],
                        "tarifa": tarifa,
                        "ciclo_bono": ciclo_bono,
                    }
                ]
            },
            conexion=conexion,
        )
        _sumar_a_semana(fecha, tarifa, sesiones_extra=1, kids_extra=0, conexion=conexion)

        if paso.renovado:
            # Esta sesión ha cerrado el bono: se anota cuándo terminó y si
            # quedó pagado (es el único momento en que se sabe), y se abre la
            # ficha del bono nuevo, que nace pendiente de pago. Con las mismas
            # condiciones económicas, que quedan congeladas en cada ciclo.
            cerrar_programa_cliente(
                nombre, ciclo_bono, fecha.isoformat(),
                pagado=not programa["pendiente_pago"], conexion=conexion,
            )
            registrar_programa_cliente(
                nombre, ciclo_bono + 1, programa["tipo_programa"], ciclo["tarifa"],
                programa["sesiones_totales"], None, conexion=conexion,
            )
            conexion.execute(
                "UPDATE programas_cliente SET modalidad = ?, precio_total = ? "
                "WHERE cliente = ? AND ciclo_bono = ?",
                (modalidad, ciclo["precio_total"], nombre, ciclo_bono + 1),
            )

        # Avisos para que Fernando se entere sin tener que estar mirando la
        # lista de clientes — decisión del 2026-07-22.
        if paso.renovado:
            registrar_aviso(
                fecha.isoformat(), "bono_terminado",
                f"'{nombre}' ha terminado su bono y el nuevo queda pendiente de pago",
                conexion=conexion,
            )
        elif paso.aviso_ultima_sesion:
            registrar_aviso(
                fecha.isoformat(), "ultima_sesion",
                f"'{nombre}' se ha quedado con 1 sola sesión de su bono — la próxima vez tocará renovar",
                conexion=conexion,
            )

    _comprobar_sincronizacion(inicio_semana.date(), fin_semana.date(), ruta)

    return {
        "numero_sesion": numero_sesion,
        "sesiones_totales": programa["sesiones_totales"],
        "renovado": paso.renovado,
        "aviso_ultima_sesion": paso.aviso_ultima_sesion,
        # Añadido el 2026-08-04 para que quien avise por pantalla sepa qué
        # decir: "sesión 3 de 5" solo vale para un bono. Las claves de
        # arriba no cambian, así que nada de lo que ya llamaba se rompe.
        "modalidad": modalidad,
        "anio": fecha.year,
        "mes": fecha.month,
    }


def editar_sesion_pt(
    entrada_id: int, nueva_fecha: str, nuevo_numero_sesion: int, ruta: Path = RUTA_POR_DEFECTO
) -> dict:
    """Corrige una entrada del historial ya guardada (p. ej. un número de
    sesión equivocado). Cada entrada se identifica por su `id` — un cliente
    puede tener varias sesiones el mismo día (decisión de Fernando,
    2026-07-24). Si el cambio de fecha mueve la sesión a otra semana, la
    economía se traslada de una semana a la otra para seguir cuadrando —
    usando siempre la tarifa histórica de la propia sesión, nunca la
    tarifa actual del cliente (bug confirmado y corregido en el sprint de
    integridad, 2026-07-28: antes se recalculaba con `cargar_tarifas()`,
    que puede haber cambiado desde entonces)."""
    with transaccion(ruta, inmediata=True) as conexion:
        fila_previa = conexion.execute(
            "SELECT fecha FROM historial_sesiones WHERE id = ?", (entrada_id,)
        ).fetchone()
        if fila_previa is None:
            raise ValueError("Esa entrada del historial ya no existe")
        fecha_original = fila_previa["fecha"]

        _bloquear_si_hay_ciclos_posteriores(conexion, entrada_id, "editar")

        resultado = editar_historial(entrada_id, nueva_fecha, nuevo_numero_sesion, conexion=conexion)

        # Antes esto solo corría `if resultado["tarifa"] is not None`, así que
        # mover una sesión de mensualidad de semana no trasladaba su hora
        # (corrección H-01, 2026-08-03). `_sumar_a_semana` ya sabe distinguir:
        # con tarifa mueve dinero y horas, sin tarifa mueve solo horas.
        cambia_de_semana = False
        if fecha_original != nueva_fecha:
            fecha_original_d = date.fromisoformat(fecha_original)
            nueva_fecha_d = date.fromisoformat(nueva_fecha)
            inicio_original, fin_original = get_week_range(datetime.combine(fecha_original_d, datetime.min.time()))
            inicio_nueva, fin_nueva = get_week_range(datetime.combine(nueva_fecha_d, datetime.min.time()))

            if inicio_original.date() != inicio_nueva.date():
                cambia_de_semana = True
                _sumar_a_semana(fecha_original_d, resultado["tarifa"], sesiones_extra=-1, kids_extra=0, conexion=conexion)
                _sumar_a_semana(nueva_fecha_d, resultado["tarifa"], sesiones_extra=1, kids_extra=0, conexion=conexion)

    if cambia_de_semana:
        _comprobar_sincronizacion(inicio_original.date(), fin_original.date(), ruta)
        _comprobar_sincronizacion(inicio_nueva.date(), fin_nueva.date(), ruta)

    return resultado


def eliminar_sesion_pt(entrada_id: int, ruta: Path = RUTA_POR_DEFECTO) -> dict:
    """Borra una entrada del historial (por su `id`) y deshace su
    aportación económica de esa semana — usando siempre la tarifa histórica
    de la propia sesión (sprint de integridad, 2026-07-28), nunca la
    tarifa actual del cliente.

    Si la sesión borrada era la más reciente de su ciclo de bono y
    completaba el bono (probablemente disparó una renovación automática,
    con el nuevo bono marcado pendiente de pago), esa renovación se
    deshace también — si no, el cliente se quedaría marcado "pendiente de
    pago" por un bono que, según el historial que queda, nunca llegó a
    completarse (decisión de Fernando, 2026-07-24)."""
    with transaccion(ruta, inmediata=True) as conexion:
        previa = conexion.execute(
            "SELECT cliente, ciclo_bono, numero_sesion, sesiones_totales FROM historial_sesiones WHERE id = ?",
            (entrada_id,),
        ).fetchone()
        if previa is None:
            raise ValueError("Esa entrada del historial ya no existe")
        cliente, ciclo_de_la_entrada = previa["cliente"], previa["ciclo_bono"]

        _bloquear_si_hay_ciclos_posteriores(conexion, entrada_id, "borrar")

        mas_reciente_del_ciclo = conexion.execute(
            "SELECT id FROM historial_sesiones WHERE cliente = ? AND ciclo_bono = ? "
            "ORDER BY fecha DESC, id DESC LIMIT 1",
            (cliente, ciclo_de_la_entrada),
        ).fetchone()
        era_la_mas_reciente_de_su_ciclo = bool(mas_reciente_del_ciclo) and mas_reciente_del_ciclo["id"] == entrada_id
        completaba_el_bono = previa["numero_sesion"] == previa["sesiones_totales"]

        deshizo_renovacion = False
        if era_la_mas_reciente_de_su_ciclo and completaba_el_bono:
            # Esta sesión disparó una renovación automática — al borrarla,
            # hay que devolver al cliente a su ciclo de bono ANTERIOR antes
            # de recalcular las sesiones completadas. Si no, el recálculo
            # buscaría en el ciclo nuevo (que se queda vacío al borrar su
            # única sesión) y pondría 0 en vez del número correcto del
            # ciclo anterior — bug real encontrado por el propio test de
            # este sprint (2026-07-28), no solo una hipótesis.
            ciclo_actual = conexion.execute(
                "SELECT ciclo_bono FROM clientes WHERE nombre = ?", (cliente,)
            ).fetchone()["ciclo_bono"]
            if ciclo_actual == ciclo_de_la_entrada + 1:
                conexion.execute(
                    "UPDATE clientes SET ciclo_bono = ? WHERE nombre = ?", (ciclo_de_la_entrada, cliente)
                )
            marcar_pendiente_pago(cliente, False, conexion=conexion)
            deshizo_renovacion = True

        entrada = eliminar_historial(entrada_id, conexion=conexion)

        # Sin el `if` que había aquí: una sesión de mensualidad (sin tarifa)
        # también tiene que devolver su HORA a la semana, aunque no devuelva
        # dinero (corrección H-01, 2026-08-03).
        fecha_d = date.fromisoformat(entrada["fecha"])
        _sumar_a_semana(fecha_d, entrada["tarifa"], sesiones_extra=-1, kids_extra=0, conexion=conexion)

    inicio, fin = get_week_range(datetime.combine(fecha_d, datetime.min.time()))
    _comprobar_sincronizacion(inicio.date(), fin.date(), ruta)

    entrada["deshizo_renovacion"] = deshizo_renovacion
    return entrada


def eliminar_cliente_con_historial(nombre: str, ruta: Path = RUTA_POR_DEFECTO) -> dict:
    """Borra un cliente por completo: primero cada una de sus sesiones (con
    `eliminar_sesion_pt`, que descuenta su facturación de la semana
    correspondiente usando la tarifa histórica de cada una), y solo después
    su ficha.

    Se hace sesión a sesión, reutilizando la lógica ya probada, en vez de
    un `DELETE` directo: borrar las filas a pelo dejaría su dinero contado
    para siempre en `semanas`/`desglose` sin ninguna sesión detrás — el
    tipo exacto de descuadre silencioso que el sprint de integridad del
    2026-07-28 se dedicó a eliminar.

    Devuelve cuántas sesiones se borraron y cuánto se descontó, para poder
    enseñárselo a Fernando después (decisión de Fernando, 2026-07-29:
    necesitaba poder retirar los clientes de prueba, cuyas sesiones
    estaban contando como facturación real)."""
    entradas = obtener_historial(nombre, ruta)
    importe = sum(entrada["tarifa"] or 0 for entrada in entradas)

    # De la más reciente a la más antigua: `eliminar_sesion_pt` deshace la
    # renovación de bono cuando la sesión borrada es la última de su ciclo,
    # así que el orden importa para que ese caso se detecte bien.
    for entrada in entradas:
        eliminar_sesion_pt(entrada["id"], ruta)

    eliminar_cliente(nombre, ruta)

    return {"sesiones_borradas": len(entradas), "importe_descontado": importe}


def registrar_clase_grupo(tipo: str, fecha: date | None = None, ruta: Path = RUTA_POR_DEFECTO) -> None:
    """tipo: 'lidomare' (con tarifa fija) o 'kids' (sin facturación hasta
    que Fernando indique el importe mensual — ver economia/registro.py).

    Queda anotada con su fecha en `clases_grupo` (no solo sumada al total
    de la semana) para poder deshacerla si se pulsa por error
    (`eliminar_ultima_clase_grupo`) y para poder comprobar que sigue
    cuadrando con la economía — todo en una única transacción atómica
    (sprint de integridad, 2026-07-28)."""
    fecha = fecha or hoy_negocio()
    if tipo not in ("lidomare", "kids"):
        raise ValueError(f"Tipo de clase desconocido: {tipo}")

    with transaccion(ruta) as conexion:
        conexion.execute("INSERT INTO clases_grupo (fecha, tipo) VALUES (?, ?)", (fecha.isoformat(), tipo))
        if tipo == "lidomare":
            _sumar_a_semana(fecha, TARIFA_CROSSFIT_LIDOMARE, sesiones_extra=1, kids_extra=0, conexion=conexion)
        else:
            _sumar_a_semana(fecha, None, sesiones_extra=0, kids_extra=1, conexion=conexion)

    inicio, fin = get_week_range(datetime.combine(fecha, datetime.min.time()))
    _comprobar_sincronizacion(inicio.date(), fin.date(), ruta)


def eliminar_ultima_clase_grupo(tipo: str, ruta: Path = RUTA_POR_DEFECTO) -> dict:
    """Deshace la clase de grupo más reciente de este tipo (p. ej. un toque
    de más en "+1 CrossFit Lidomare/Kids") y su aportación económica, en
    una única transacción atómica."""
    if tipo not in ("lidomare", "kids"):
        raise ValueError(f"Tipo de clase desconocido: {tipo}")

    with transaccion(ruta) as conexion:
        fila = conexion.execute(
            "SELECT id, fecha FROM clases_grupo WHERE tipo = ? ORDER BY id DESC LIMIT 1", (tipo,)
        ).fetchone()
        if fila is None:
            raise ValueError(f"No hay ninguna clase de '{tipo}' registrada todavía")
        conexion.execute("DELETE FROM clases_grupo WHERE id = ?", (fila["id"],))

        fecha = date.fromisoformat(fila["fecha"])
        if tipo == "lidomare":
            _sumar_a_semana(fecha, TARIFA_CROSSFIT_LIDOMARE, sesiones_extra=-1, kids_extra=0, conexion=conexion)
        else:
            _sumar_a_semana(fecha, None, sesiones_extra=0, kids_extra=-1, conexion=conexion)

    inicio, fin = get_week_range(datetime.combine(fecha, datetime.min.time()))
    _comprobar_sincronizacion(inicio.date(), fin.date(), ruta)

    return {"fecha": fila["fecha"], "tipo": tipo}
