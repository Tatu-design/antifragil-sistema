"""Motor de escenarios compartidos — el contrato de la migración (Fase 3).

Este módulo NO contiene pruebas. Contiene el intérprete que ejecuta los
escenarios de `tests/fixtures/escenarios.json` contra el sistema Python
actual y devuelve una **fotografía normalizada** del resultado.

La idea, en lenguaje llano
--------------------------
Para poder demostrar que la aplicación nueva hace exactamente lo mismo que
la actual hace falta algo que las dos puedan ejecutar y comparar. Ese algo
es un archivo de datos —ni Python ni TypeScript— que describe:

    "parte de esta situación, haz estos pasos, y esto es lo que tiene que
     quedar".

Python lo ejecuta con este motor. Cuando exista la versión de Next.js,
ejecutará **el mismo archivo** con su propio motor. Si las dos fotografías
coinciden, son equivalentes. Si no, la diferencia sale señalada campo a
campo, sin discusión posible.

Tres reglas que hacen que esto valga para algo
----------------------------------------------
1. **Los resultados esperados están escritos a mano**, calculados desde las
   reglas de negocio (3 sesiones × 45 € = 135 €), NO capturados de lo que
   devuelve el sistema. Si se capturasen, un fallo actual se convertiría en
   la especificación y la app nueva lo copiaría fielmente.

2. **La fotografía es determinista.** Nada de identificadores internos, ni
   horas de reloj, ni orden accidental: todo va ordenado por claves de
   negocio. Dos ejecuciones del mismo escenario dan exactamente lo mismo.

3. **Los importes se comparan redondeados a 2 decimales**, que es la unidad
   real del negocio (el céntimo). La precisión en bruto de la coma flotante
   se vigila aparte, en `tests/test_equivalencia_reglas.py`, porque ahí sí
   importa cómo lo guarda cada base de datos.

Datos ficticios
---------------
Ningún escenario usa nombres, tarifas ni cifras de clientes reales. Los
nombres son `Cliente A`, `Cliente B`, `Pareja C`… igual que en el resto de
la documentación del proyecto, que es público.
"""

import json
import os
from datetime import date
from pathlib import Path
from tempfile import mkstemp

import basedatos
import clientes.repositorio as cr
import economia.registro as er
import registrar_asistencia as ra

RUTA_FIXTURES = Path(__file__).parent / "fixtures" / "escenarios.json"

# Los importes se comparan al céntimo. Ver regla 3 del docstring.
DECIMALES = 2


def cargar_escenarios(ruta: Path = RUTA_FIXTURES) -> list[dict]:
    """Lee el archivo de escenarios. Es un JSON plano a propósito: tiene que
    poder leerlo TypeScript sin ninguna librería."""
    with open(ruta, encoding="utf-8") as archivo:
        return json.load(archivo)["escenarios"]


def _euros(valor):
    """Redondea un importe al céntimo, conservando `None` como `None`.

    `None` y `0` son cosas distintas en este sistema y no se pueden
    confundir: una sesión con `tarifa = None` cuenta como hora trabajada sin
    aportar dinero; una con tarifa 0 aportaría 0 €. Si esta función
    convirtiera `None` en 0 borraría esa diferencia justo en el sitio donde
    se comprueba."""
    if valor is None:
        return None
    return round(float(valor), DECIMALES)


def _fecha(texto: str | None) -> date | None:
    return date.fromisoformat(texto) if texto else None


# ---------------------------------------------------------------------------
# Ejecución de los pasos
# ---------------------------------------------------------------------------


def _paso_programa(ruta, paso):
    cr.guardar_programa(paso["nombre"], float(paso["tarifa"]), int(paso["sesiones"]), ruta=ruta)


def _paso_alta(ruta, paso):
    cr.crear_cliente(
        paso["cliente"],
        paso["programa"],
        int(paso.get("completadas", 0)),
        bool(paso.get("pendiente_pago", False)),
        ruta=ruta,
    )


def _paso_servicio(ruta, paso):
    cr.configurar_servicio(
        paso["cliente"],
        paso["modalidad"],
        nombre_servicio=paso.get("servicio"),
        sesiones_totales=paso.get("sesiones_totales"),
        precio_total=paso.get("precio_total"),
        cuota_mensual=paso.get("cuota_mensual"),
        tarifa=paso.get("tarifa"),
        sesiones_referencia=paso.get("sesiones_referencia"),
        pendiente_pago=paso.get("pendiente_pago"),
        hoy=_fecha(paso.get("fecha")),
        ruta=ruta,
    )


def _paso_estado(ruta, paso):
    actual = cr.leer_clientes(ruta)[paso["cliente"]]
    cr.actualizar_cliente(
        paso["cliente"],
        paso["cliente"],
        actual["tipo_programa"],
        actual["sesiones_completadas"],
        actual["pendiente_pago"] == "Sí",
        estado=paso["estado"],
        ruta=ruta,
    )


def _paso_firmar(ruta, paso):
    """Firma una o varias sesiones. `clave_idempotencia` se pasa tal cual:
    repetir la misma clave es justamente lo que prueba la capa 2 de las
    cuatro anti-duplicado."""
    for _ in range(int(paso.get("veces", 1))):
        ra.registrar_sesion_pt(
            paso["cliente"],
            fecha=_fecha(paso["fecha"]),
            clave_idempotencia=paso.get("clave_idempotencia"),
            ruta=ruta,
        )


def _paso_borrar_sesion(ruta, paso):
    """`indice` va sobre el historial tal y como lo devuelve la aplicación:
    0 es la sesión MÁS RECIENTE (orden fecha desc, id desc)."""
    historial = cr.obtener_historial(paso["cliente"], ruta=ruta)
    ra.eliminar_sesion_pt(historial[int(paso.get("indice", 0))]["id"], ruta=ruta)


def _paso_editar_sesion(ruta, paso):
    historial = cr.obtener_historial(paso["cliente"], ruta=ruta)
    entrada = historial[int(paso.get("indice", 0))]
    ra.editar_sesion_pt(
        entrada["id"],
        paso.get("nueva_fecha", entrada["fecha"]),
        int(paso.get("nuevo_numero", entrada["numero_sesion"])),
        ruta=ruta,
    )


def _paso_clase(ruta, paso):
    for _ in range(int(paso.get("veces", 1))):
        ra.registrar_clase_grupo(paso["tipo"], fecha=_fecha(paso["fecha"]), ruta=ruta)


def _paso_deshacer_clase(ruta, paso):
    ra.eliminar_ultima_clase_grupo(paso["tipo"], ruta=ruta)


def _paso_facturacion_kids(ruta, paso):
    er.registrar_facturacion_kids(int(paso["anio"]), int(paso["mes"]), float(paso["importe"]), ruta=ruta)


def _paso_ajuste_mensual(ruta, paso):
    er.registrar_ajuste_mensual(
        int(paso["anio"]),
        int(paso["mes"]),
        float(paso["importe"]),
        int(paso["horas"]),
        paso["motivo"],
        origen=paso.get("origen", "legacy"),
        ruta=ruta,
    )


def _paso_marcar_pago(ruta, paso):
    cr.marcar_pago_del_ciclo(paso["cliente"], bool(paso["pagado"]), ciclo=paso.get("ciclo"), ruta=ruta)


def _paso_renombrar(ruta, paso):
    actual = cr.leer_clientes(ruta)[paso["cliente"]]
    cr.actualizar_cliente(
        paso["cliente"],
        paso["nuevo"],
        actual["tipo_programa"],
        actual["sesiones_completadas"],
        actual["pendiente_pago"] == "Sí",
        ruta=ruta,
    )


def _paso_borrar_cliente(ruta, paso):
    ra.eliminar_cliente_con_historial(paso["cliente"], ruta=ruta)


def _paso_ciclo_legacy(ruta, paso):
    """Inserta un servicio tal y como quedó en los datos MIGRADOS de antes de
    esta versión — en particular con `pagado` nulo, que la aplicación no sabe
    generar por su cuenta (nunca se registró aquel cobro y no se supone).

    Es la única forma de reproducir ese estado, y hay que reproducirlo:
    `pagado = NULL` no significa "sin pagar" y la app nueva tiene que tratarlo
    igual que la actual."""
    with basedatos.transaccion(ruta) as conexion:
        conexion.execute(
            "INSERT INTO programas_cliente "
            "(cliente, ciclo_bono, tipo_programa, modalidad, tarifa, sesiones_totales, "
            " precio_total, cuota_mensual, sesiones_referencia, anio, mes, fecha_inicio, fecha_fin, pagado) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                paso["cliente"], int(paso["ciclo"]), paso["servicio"], paso.get("modalidad", "bono"),
                paso.get("tarifa"), int(paso.get("sesiones_totales", 0)), paso.get("precio_total"),
                paso.get("cuota_mensual"), paso.get("sesiones_referencia"), paso.get("anio"),
                paso.get("mes"), paso.get("fecha_inicio"), paso.get("fecha_fin"),
                None if paso.get("pagado") is None else int(paso["pagado"]),
            ),
        )


def _paso_abrir_mes(ruta, paso):
    """Equivale a que Fernando abra la lista de clientes en ese mes: es lo
    que dispara la renovación de mensualidades y cuentas."""
    cr.asegurar_ciclos_mensuales(int(paso["anio"]), int(paso["mes"]), ruta=ruta)


PASOS = {
    "programa": _paso_programa,
    "alta": _paso_alta,
    "servicio": _paso_servicio,
    "estado": _paso_estado,
    "firmar": _paso_firmar,
    "borrar_sesion": _paso_borrar_sesion,
    "editar_sesion": _paso_editar_sesion,
    "clase": _paso_clase,
    "deshacer_clase": _paso_deshacer_clase,
    "facturacion_kids": _paso_facturacion_kids,
    "ajuste_mensual": _paso_ajuste_mensual,
    "marcar_pago": _paso_marcar_pago,
    "renombrar": _paso_renombrar,
    "borrar_cliente": _paso_borrar_cliente,
    "abrir_mes": _paso_abrir_mes,
    "ciclo_legacy": _paso_ciclo_legacy,
}


def ejecutar_pasos(ruta: Path, pasos: list[dict]) -> list[str]:
    """Ejecuta los pasos en orden. Un paso marcado `"debe_fallar": true`
    tiene que lanzar error: si NO falla, es un fallo del escenario, porque
    justamente comprueba que el sistema rechaza algo prohibido.

    Devuelve la lista de errores capturados, para poder comprobar también
    que el mensaje dice lo que tiene que decir."""
    errores: list[str] = []
    for numero, paso in enumerate(pasos, start=1):
        accion = paso["accion"]
        if accion not in PASOS:
            raise ValueError(f"Paso {numero}: acción desconocida '{accion}'")
        try:
            PASOS[accion](ruta, paso)
        except Exception as error:  # noqa: BLE001 — se re-lanza si no se esperaba
            if not paso.get("debe_fallar"):
                raise AssertionError(f"Paso {numero} ({accion}) falló sin esperarse: {error}") from error
            errores.append(str(error))
            continue
        if paso.get("debe_fallar"):
            raise AssertionError(f"Paso {numero} ({accion}) debía fallar y no falló")
    return errores


# ---------------------------------------------------------------------------
# La fotografía normalizada
# ---------------------------------------------------------------------------


def _foto_clientes(conexion) -> list[dict]:
    filas = conexion.execute(
        "SELECT nombre, estado, pendiente_pago, sesiones_completadas, ciclo_bono, tipo_programa "
        "FROM clientes ORDER BY nombre"
    ).fetchall()
    return [
        {
            "cliente": f["nombre"],
            "estado": f["estado"],
            "pendiente_pago": bool(f["pendiente_pago"]),
            "sesiones_completadas": f["sesiones_completadas"],
            "ciclo": f["ciclo_bono"],
            "programa": f["tipo_programa"],
        }
        for f in filas
    ]


def _foto_ciclos(conexion) -> list[dict]:
    filas = conexion.execute(
        "SELECT cliente, ciclo_bono, COALESCE(modalidad,'bono') AS modalidad, tipo_programa, tarifa, "
        "       sesiones_totales, precio_total, cuota_mensual, sesiones_referencia, anio, mes, "
        "       fecha_inicio, fecha_fin, pagado "
        "FROM programas_cliente ORDER BY cliente, ciclo_bono"
    ).fetchall()
    return [
        {
            "cliente": f["cliente"],
            "ciclo": f["ciclo_bono"],
            "modalidad": f["modalidad"],
            "servicio": f["tipo_programa"],
            "tarifa": _euros(f["tarifa"]),
            "sesiones_totales": f["sesiones_totales"],
            "precio_total": _euros(f["precio_total"]),
            "cuota_mensual": _euros(f["cuota_mensual"]),
            "sesiones_referencia": f["sesiones_referencia"],
            "anio": f["anio"],
            "mes": f["mes"],
            "fecha_inicio": f["fecha_inicio"],
            "fecha_fin": f["fecha_fin"],
            # Se conserva el tri-estado a propósito: None = nunca se
            # registró, y NO es lo mismo que "sin pagar".
            "pagado": None if f["pagado"] is None else bool(f["pagado"]),
        }
        for f in filas
    ]


def _foto_historial(conexion) -> list[dict]:
    """Sin `id` ni `hora`: el identificador interno puede no coincidir entre
    dos bases de datos distintas y la hora depende del reloj. Lo que sí tiene
    que coincidir es el orden, la fecha, el número de sesión y la tarifa
    congelada."""
    filas = conexion.execute(
        "SELECT cliente, fecha, numero_sesion, sesiones_totales, tarifa, ciclo_bono, tipo_programa "
        "FROM historial_sesiones ORDER BY cliente, fecha, numero_sesion, id"
    ).fetchall()
    return [
        {
            "cliente": f["cliente"],
            "fecha": f["fecha"],
            "numero_sesion": f["numero_sesion"],
            "sesiones_totales": f["sesiones_totales"],
            "tarifa": _euros(f["tarifa"]),
            "ciclo": f["ciclo_bono"],
            "servicio": f["tipo_programa"],
        }
        for f in filas
    ]


def _foto_clases(conexion) -> list[dict]:
    filas = conexion.execute("SELECT fecha, tipo FROM clases_grupo ORDER BY fecha, tipo, id").fetchall()
    return [{"fecha": f["fecha"], "tipo": f["tipo"]} for f in filas]


def _foto_cargos(conexion) -> list[dict]:
    filas = conexion.execute(
        "SELECT cliente, anio, mes, concepto, ciclo, importe, pagado FROM cargos_mensuales "
        "ORDER BY cliente, anio, mes, concepto"
    ).fetchall()
    return [
        {
            "cliente": f["cliente"],
            "anio": f["anio"],
            "mes": f["mes"],
            "concepto": f["concepto"],
            "ciclo": f["ciclo"],
            "importe": _euros(f["importe"]),
            "pagado": bool(f["pagado"]),
        }
        for f in filas
    ]


def _foto_semanas(ruta: Path, conexion) -> list[dict]:
    claves = conexion.execute("SELECT fecha_inicio FROM semanas ORDER BY fecha_inicio").fetchall()
    fotos = []
    for fila in claves:
        semana = er.obtener_semana(fila["fecha_inicio"], ruta)
        fotos.append(
            {
                "inicio": semana["fecha_inicio"],
                "fin": semana["fecha_fin"],
                "facturacion_total": _euros(semana["facturacion_total"]),
                "horas_totales": semana["horas_totales"],
                "sesiones_kids": semana["sesiones_kids"],
                "facturacion_kids": _euros(semana["facturacion_kids"]),
                "provisional": semana["provisional"],
            }
        )
    return fotos


def _foto_meses(ruta: Path) -> list[dict]:
    fotos = []
    for mes in sorted(er.listar_meses(ruta), key=lambda m: (m["anio"], m["mes"])):
        fotos.append(
            {
                "anio": mes["anio"],
                "mes": mes["mes"],
                "facturacion_total": _euros(mes["facturacion_total"]),
                "horas_totales": mes["horas_totales"],
                "precio_medio_hora": _euros(mes["precio_medio_hora"]),
                "cuotas": mes["cuotas"],
                "facturacion_cuotas": _euros(mes["facturacion_cuotas"]),
                "sesiones_kids": mes["sesiones_kids"],
                "facturacion_kids": _euros(mes["facturacion_kids"]),
                "provisional": mes["provisional"],
                "ajuste_importe": _euros(mes["ajuste_importe"]),
                "ajuste_horas": mes["ajuste_horas"],
                "por_modalidad": {
                    nombre: {"horas": datos["horas"], "facturacion": _euros(datos["facturacion"])}
                    for nombre, datos in sorted(mes["por_modalidad"].items())
                },
            }
        )
    return fotos


def fotografiar(ruta: Path) -> dict:
    """Todo el estado observable del sistema, ordenado y normalizado.

    Es lo que la versión de Next.js tendrá que reproducir campo a campo."""
    with basedatos.conectar(ruta) as conexion:
        foto = {
            "clientes": _foto_clientes(conexion),
            "ciclos": _foto_ciclos(conexion),
            "historial": _foto_historial(conexion),
            "clases_grupo": _foto_clases(conexion),
            "cargos_mensuales": _foto_cargos(conexion),
            "semanas": _foto_semanas(ruta, conexion),
        }
    # Fuera de la conexión: `listar_meses` abre la suya.
    foto["meses"] = _foto_meses(ruta)
    return foto


# ---------------------------------------------------------------------------
# Ejecutar un escenario completo
# ---------------------------------------------------------------------------


def ejecutar(escenario: dict) -> dict:
    """Monta una base de datos temporal vacía, ejecuta los pasos y devuelve
    la fotografía. Nunca toca `datos/antifragil.db`."""
    descriptor, ruta_texto = mkstemp(suffix=".db", prefix="paridad-")
    os.close(descriptor)
    ruta = Path(ruta_texto)
    try:
        basedatos.crear_esquema(ruta)
        errores = ejecutar_pasos(ruta, escenario["pasos"])
        foto = fotografiar(ruta)
        foto["errores"] = errores
        return foto
    finally:
        for sufijo in ("", "-wal", "-shm"):
            try:
                Path(str(ruta) + sufijo).unlink(missing_ok=True)
            except OSError:
                # En Windows SQLite puede tardar un instante en soltar el
                # archivo. No es un fallo de la aplicación.
                pass


def comparar(esperado: dict, obtenido: dict) -> list[str]:
    """Compara solo las secciones que el escenario declara esperar.

    Un escenario que solo habla de meses no tiene que enumerar todo el
    historial: se comprueba lo que afirma. Devuelve una lista de diferencias
    en lenguaje concreto — vacía si todo coincide."""
    diferencias: list[str] = []
    for seccion, valor_esperado in esperado.items():
        valor_obtenido = obtenido.get(seccion)
        if valor_esperado == valor_obtenido:
            continue
        if isinstance(valor_esperado, list) and isinstance(valor_obtenido, list):
            if len(valor_esperado) != len(valor_obtenido):
                diferencias.append(
                    f"{seccion}: se esperaban {len(valor_esperado)} filas y hay {len(valor_obtenido)}"
                )
            for indice, (fila_e, fila_o) in enumerate(zip(valor_esperado, valor_obtenido)):
                for campo, esperado_campo in fila_e.items():
                    obtenido_campo = fila_o.get(campo)
                    if esperado_campo != obtenido_campo:
                        diferencias.append(
                            f"{seccion}[{indice}].{campo}: esperado {esperado_campo!r}, obtenido {obtenido_campo!r}"
                        )
        else:
            diferencias.append(f"{seccion}: esperado {valor_esperado!r}, obtenido {valor_obtenido!r}")
    return diferencias
