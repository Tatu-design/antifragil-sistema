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
    cargar_programas,
    cargar_tarifas,
    editar_historial,
    eliminar_cliente,
    eliminar_historial,
    marcar_pendiente_pago,
    obtener_historial,
    registrar_historial,
)
from economia.calculo import TARIFA_CROSSFIT_LIDOMARE
from economia.registro import (
    obtener_desglose_semana,
    obtener_semana,
    registrar_semana,
    verificar_sincronizacion_semana,
)
from programas.procesar import procesar_una_sesion
from zona_horaria import hoy_negocio


def _sumar_a_semana(fecha: date, tarifa: float | None, sesiones_extra: int, kids_extra: int, conexion) -> None:
    """Suma (o resta) sesiones a la economía de la semana que contiene
    `fecha`, dentro de la conexión/transacción que le pasa quien llama —
    ya no abre sus propias conexiones sueltas (sprint de integridad,
    2026-07-28)."""
    inicio, fin = get_week_range(datetime.combine(fecha, datetime.min.time()))
    clave = inicio.date().isoformat()

    desglose = obtener_desglose_semana(clave, conexion=conexion)
    if tarifa is not None:
        entrada = desglose.setdefault(tarifa, {"sesiones": 0, "facturacion": 0.0})
        entrada["sesiones"] += sesiones_extra
        entrada["facturacion"] += sesiones_extra * tarifa

    semana_actual = obtener_semana(clave, conexion=conexion)
    sesiones_kids = (semana_actual["sesiones_kids"] if semana_actual else 0) + kids_extra

    registrar_semana(inicio.date(), fin.date(), desglose, sesiones_kids, conexion=conexion)


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
    clave nueva, así que una segunda sesión real sí se puede firmar."""
    fecha = fecha or hoy_negocio()
    programas, incompletos = cargar_programas(ruta)

    if nombre in incompletos:
        raise ValueError(f"A '{nombre}' le faltan datos de programa por rellenar — revísalo en Editar cliente")
    programa = programas.get(nombre)
    if programa is None:
        raise ValueError(f"'{nombre}' no tiene un programa asignado")

    paso, numero_sesion = procesar_una_sesion(programa)
    tarifa = cargar_tarifas(ruta).get(nombre)

    inicio_semana, fin_semana = get_week_range(datetime.combine(fecha, datetime.min.time()))

    with transaccion(ruta) as conexion:
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
                }
            conexion.execute(
                "INSERT INTO firmas_idempotencia (clave, creado) VALUES (?, ?)",
                (clave_idempotencia, hoy_negocio().isoformat()),
            )

        ciclo_fila = conexion.execute("SELECT ciclo_bono FROM clientes WHERE nombre = ?", (nombre,)).fetchone()
        ciclo_bono = ciclo_fila["ciclo_bono"] if ciclo_fila else 1

        aplicar_actualizaciones({nombre: paso}, conexion=conexion)
        registrar_historial(
            {
                nombre: [
                    {
                        "fecha": fecha.isoformat(),
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
    with transaccion(ruta) as conexion:
        fila_previa = conexion.execute(
            "SELECT fecha FROM historial_sesiones WHERE id = ?", (entrada_id,)
        ).fetchone()
        if fila_previa is None:
            raise ValueError("Esa entrada del historial ya no existe")
        fecha_original = fila_previa["fecha"]

        resultado = editar_historial(entrada_id, nueva_fecha, nuevo_numero_sesion, conexion=conexion)

        cambia_de_semana = False
        if fecha_original != nueva_fecha and resultado["tarifa"] is not None:
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
    with transaccion(ruta) as conexion:
        previa = conexion.execute(
            "SELECT cliente, ciclo_bono, numero_sesion, sesiones_totales FROM historial_sesiones WHERE id = ?",
            (entrada_id,),
        ).fetchone()
        if previa is None:
            raise ValueError("Esa entrada del historial ya no existe")
        cliente, ciclo_de_la_entrada = previa["cliente"], previa["ciclo_bono"]

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

        fecha_d = date.fromisoformat(entrada["fecha"])
        if entrada["tarifa"] is not None:
            _sumar_a_semana(fecha_d, entrada["tarifa"], sesiones_extra=-1, kids_extra=0, conexion=conexion)

    if entrada["tarifa"] is not None:
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
