"""Registro histórico de facturación, consultable por semana o por mes en
cualquier momento.

Desde el 2026-07-18, esto es SQLite (`datos/antifragil.db`, ver
`basedatos.py`) — antes era un Excel. Se mantienen las mismas funciones
públicas que ya usaban `cierre_semanal/` y `economia/cli.py`.

Dos tablas:
- `semanas`: una fila por semana cerrada (vista SEMANAL, agrupada por el
  lunes de cada semana — puede mezclar sesiones de dos meses distintos si
  la semana cae a caballo, y eso es correcto para la vista semanal).
- `desglose`: una fila por (semana, tarifa) — el detalle por tarifa que
  antes llevaba Fernando a mano en su propia hoja de cálculo.

**La vista MENSUAL (`listar_meses`/`obtener_mes`) NO usa `semanas`.** Antes
agrupaba las semanas por el mes de su lunes, lo que atribuía una semana
entera (p. ej. 27 de julio-2 de agosto) al mes del lunes aunque varias
sesiones fueran realmente de otro mes — bug confirmado y corregido en el
sprint de integridad del 2026-07-28. Ahora el mes se calcula directamente
desde `historial_sesiones` y `clases_grupo`, agrupando por la fecha REAL de
cada sesión/clase — la única fuente que tiene esa fecha real.

CrossFit Kids: cada clase cuenta como 1 hora trabajada; la facturación
mensual se introduce a mano (`registrar_facturacion_kids`) y se guarda ya
por mes real en `facturacion_kids_mensual` — antes de introducirla, la
vista mensual debe marcarse como provisional (le falta la facturación/horas
de Kids todavía)."""

import sqlite3
from datetime import date
from pathlib import Path

from basedatos import RUTA_POR_DEFECTO, conectar
from economia.calculo import TARIFA_CROSSFIT_LIDOMARE, resumir


def registrar_semana(
    fecha_inicio: date,
    fecha_fin: date,
    desglose: dict[float, dict],
    sesiones_kids: int,
    ruta: Path = RUTA_POR_DEFECTO,
    conexion: sqlite3.Connection | None = None,
) -> None:
    """Guarda (o actualiza, si ya existía) el resultado económico de una
    semana. `desglose`: {tarifa: {"sesiones": n, "facturacion": importe}}
    — formato que devuelve `economia.calculo.calcular_desglose`.

    `conexion`: si se pasa una conexión ya abierta (de una transacción más
    amplia, ver `registrar_asistencia.py`), se reutiliza en vez de abrir
    otra — así firmar una sesión es una única operación atómica (sprint de
    integridad, 2026-07-28)."""
    resumen = resumir(desglose)
    anio, mes = fecha_inicio.year, fecha_inicio.month
    clave = fecha_inicio.isoformat()

    def _hacer(conexion: sqlite3.Connection) -> None:
        conexion.execute(
            """
            INSERT INTO semanas
                (fecha_inicio, fecha_fin, anio, mes, facturacion_pt_lidomare, horas_pt_lidomare, sesiones_kids)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(fecha_inicio) DO UPDATE SET
                fecha_fin = excluded.fecha_fin,
                facturacion_pt_lidomare = excluded.facturacion_pt_lidomare,
                horas_pt_lidomare = excluded.horas_pt_lidomare,
                sesiones_kids = excluded.sesiones_kids
            """,
            (clave, fecha_fin.isoformat(), anio, mes, resumen["facturacion_total"], resumen["horas_totales"], sesiones_kids),
        )
        conexion.execute("DELETE FROM desglose WHERE fecha_inicio_semana = ?", (clave,))
        for tarifa, datos in desglose.items():
            conexion.execute(
                "INSERT INTO desglose (fecha_inicio_semana, tarifa, sesiones, facturacion) VALUES (?, ?, ?, ?)",
                (clave, tarifa, datos["sesiones"], datos["facturacion"]),
            )

    if conexion is not None:
        _hacer(conexion)
    else:
        with conectar(ruta) as conexion:
            _hacer(conexion)


def obtener_desglose_semana(
    fecha_inicio_iso: str, ruta: Path = RUTA_POR_DEFECTO, conexion: sqlite3.Connection | None = None
) -> dict[float, dict]:
    """El desglose por tarifa ya guardado de una semana — para sumarle un
    día nuevo antes de volver a guardar (ver actualización diaria en
    `webapp/app.py`, ruta `/admin/procesar-dia`)."""
    if conexion is not None:
        filas = conexion.execute(
            "SELECT tarifa, sesiones, facturacion FROM desglose WHERE fecha_inicio_semana = ?",
            (fecha_inicio_iso,),
        ).fetchall()
        return {fila["tarifa"]: {"sesiones": fila["sesiones"], "facturacion": fila["facturacion"]} for fila in filas}

    if not ruta.exists():
        return {}
    with conectar(ruta) as conexion:
        filas = conexion.execute(
            "SELECT tarifa, sesiones, facturacion FROM desglose WHERE fecha_inicio_semana = ?",
            (fecha_inicio_iso,),
        ).fetchall()
    return {fila["tarifa"]: {"sesiones": fila["sesiones"], "facturacion": fila["facturacion"]} for fila in filas}


def calcular_sesiones_pt_desde_historial(
    fecha_inicio_iso: str, fecha_fin_iso: str, ruta: Path = RUTA_POR_DEFECTO
) -> dict[float, int]:
    """Cuenta, tarifa a tarifa, las sesiones de PT que de verdad están
    firmadas en `historial_sesiones` entre dos fechas — usando la tarifa
    que se guardó en el momento de firmar cada una, no la tarifa actual
    del cliente (que pudo cambiar después). Es la fuente de verdad contra
    la que se compara `desglose` en `verificar_sincronizacion_semana`."""
    if not ruta.exists():
        return {}
    with conectar(ruta) as conexion:
        filas = conexion.execute(
            "SELECT tarifa, COUNT(*) AS sesiones FROM historial_sesiones "
            "WHERE fecha BETWEEN ? AND ? AND tarifa IS NOT NULL "
            "GROUP BY tarifa",
            (fecha_inicio_iso, fecha_fin_iso),
        ).fetchall()
    return {fila["tarifa"]: fila["sesiones"] for fila in filas}


def calcular_clases_grupo_desde_registro(
    fecha_inicio_iso: str, fecha_fin_iso: str, ruta: Path = RUTA_POR_DEFECTO
) -> dict[str, int]:
    """Cuenta, por tipo ('lidomare'/'kids'), las clases de grupo realmente
    registradas en `clases_grupo` entre dos fechas — la fuente de verdad
    para esas clases, igual que `historial_sesiones` lo es para PT (tabla
    añadida el 2026-07-24 para poder deshacer un "+1" por error y
    comprobar que sigue cuadrando con la economía)."""
    if not ruta.exists():
        return {}
    with conectar(ruta) as conexion:
        filas = conexion.execute(
            "SELECT tipo, COUNT(*) AS n FROM clases_grupo WHERE fecha BETWEEN ? AND ? GROUP BY tipo",
            (fecha_inicio_iso, fecha_fin_iso),
        ).fetchall()
    return {fila["tipo"]: fila["n"] for fila in filas}


def verificar_sincronizacion_semana(
    fecha_inicio: date, fecha_fin: date, ruta: Path = RUTA_POR_DEFECTO, desglose_guardado: dict[float, dict] | None = None
) -> list[str]:
    """Compara el historial real de sesiones firmadas (PT y clases de
    grupo) contra lo que quedó guardado en `desglose`/`semanas` para esa
    semana. Si no coinciden es que algo se desincronizó (p. ej. una sesión
    borrada sin deshacer su aportación económica) — decisión de Fernando
    del 2026-07-23, tras detectar un descuadre así con Pareja C. Nunca
    corrige nada por su cuenta, solo detecta y devuelve la discrepancia
    para que se avise.

    `desglose_guardado`: si quien llama ya tiene el desglose recién leído
    (p. ej. `registrar_asistencia._sumar_a_semana`, justo después de
    guardarlo), se puede pasar aquí para no volver a abrir la base de datos
    a preguntar por algo que ya se sabe (optimización del 2026-07-24)."""
    clave = fecha_inicio.isoformat()
    clave_fin = fecha_fin.isoformat()
    reales = calcular_sesiones_pt_desde_historial(clave, clave_fin, ruta)
    guardado = desglose_guardado if desglose_guardado is not None else obtener_desglose_semana(clave, ruta)

    discrepancias = []
    # La tarifa de CrossFit Lidomare vive en el mismo `desglose` que las de
    # PT, pero no viene de `historial_sesiones` (ningún cliente tiene esa
    # tarifa) — se compara aparte, más abajo, contra `clases_grupo`. Si no
    # se excluyera aquí, cada clase de Lidomare generaría una falsa alarma
    # ("0 sesiones reales") además de la comprobación correcta (encontrado
    # el 2026-07-24 al probar este mismo caso).
    for tarifa in sorted((set(reales) | set(guardado)) - {TARIFA_CROSSFIT_LIDOMARE}):
        esperado = reales.get(tarifa, 0)
        actual = guardado.get(tarifa, {}).get("sesiones", 0)
        if esperado != actual:
            discrepancias.append(
                f"Semana del {clave}: la tarifa {tarifa}€ tiene {actual} sesiones guardadas en la "
                f"economía pero {esperado} sesiones reales en el historial"
            )

    clases_reales = calcular_clases_grupo_desde_registro(clave, clave_fin, ruta)
    lidomare_esperado = clases_reales.get("lidomare", 0)
    lidomare_guardado = guardado.get(TARIFA_CROSSFIT_LIDOMARE, {}).get("sesiones", 0)
    if lidomare_esperado != lidomare_guardado:
        discrepancias.append(
            f"Semana del {clave}: CrossFit Lidomare tiene {lidomare_guardado} clases guardadas en "
            f"la economía pero {lidomare_esperado} clases reales registradas"
        )

    kids_esperado = clases_reales.get("kids", 0)
    semana_guardada = obtener_semana(clave, ruta)
    kids_guardado = semana_guardada["sesiones_kids"] if semana_guardada else 0
    if kids_esperado != kids_guardado:
        discrepancias.append(
            f"Semana del {clave}: CrossFit Kids tiene {kids_guardado} clases guardadas en la "
            f"economía pero {kids_esperado} clases reales registradas"
        )

    return discrepancias


def precio_sesion_kids(anio: int, mes: int, ruta: Path = RUTA_POR_DEFECTO, conexion: sqlite3.Connection | None = None) -> float:
    """Precio por clase de CrossFit Kids de un mes real: su facturación
    mensual dividida entre las clases que de verdad se dieron ese mes según
    `clases_grupo` (fecha real de cada clase). Devuelve 0 si no hay
    facturación introducida todavía o no hubo clases."""

    def _hacer(conexion: sqlite3.Connection) -> float:
        importe = conexion.execute(
            "SELECT importe FROM facturacion_kids_mensual WHERE anio = ? AND mes = ?", (anio, mes)
        ).fetchone()
        if importe is None:
            return 0.0
        clases = conexion.execute(
            "SELECT COUNT(*) AS n FROM clases_grupo WHERE tipo = 'kids' AND fecha LIKE ?",
            (f"{anio:04d}-{mes:02d}-%",),
        ).fetchone()["n"]
        return importe["importe"] / clases if clases else 0.0

    if conexion is not None:
        return _hacer(conexion)
    if not ruta.exists():
        return 0.0
    with conectar(ruta) as conexion:
        return _hacer(conexion)


def _repartir_kids_en_semanas(conexion: sqlite3.Connection) -> None:
    """Recalcula `semanas.facturacion_kids` para TODAS las semanas a partir
    de las clases reales de `clases_grupo` y del precio por clase del mes al
    que pertenece cada clase (segunda auditoría, 2026-07-30).

    Antes se repartía con `UPDATE semanas ... WHERE anio = ? AND mes = ?`,
    es decir, según el mes del LUNES de cada semana y el número de clases
    guardado en `semanas.sesiones_kids`. Eso rompía en dos casos reales:

    - Una semana a caballo entre dos meses (una clase el 31 de julio y otra
      el 1 de agosto) se facturaba entera al precio de un solo mes.
    - Si las clases de un mes caían todas en semanas cuyo lunes era del mes
      anterior, no había ninguna fila que actualizar y la facturación se
      perdía.

    Ahora cada clase se valora al precio de SU mes y se suma a la semana que
    de verdad la contiene, así que una semana a caballo suma la parte de
    cada mes por separado."""
    precios: dict[tuple[int, int], float] = {}

    def precio(anio: int, mes: int) -> float:
        if (anio, mes) not in precios:
            precios[(anio, mes)] = precio_sesion_kids(anio, mes, conexion=conexion)
        return precios[(anio, mes)]

    semanas = conexion.execute("SELECT fecha_inicio, fecha_fin FROM semanas").fetchall()
    for semana in semanas:
        clases = conexion.execute(
            "SELECT fecha FROM clases_grupo WHERE tipo = 'kids' AND fecha BETWEEN ? AND ?",
            (semana["fecha_inicio"], semana["fecha_fin"]),
        ).fetchall()

        total = 0.0
        for clase in clases:
            fecha = date.fromisoformat(clase["fecha"])
            total += precio(fecha.year, fecha.month)

        conexion.execute(
            "UPDATE semanas SET sesiones_kids = ?, facturacion_kids = ? WHERE fecha_inicio = ?",
            (len(clases), total if total else None, semana["fecha_inicio"]),
        )


def registrar_facturacion_kids(anio: int, mes: int, facturacion_total_kids: float, ruta: Path = RUTA_POR_DEFECTO) -> float:
    """Guarda la facturación mensual de CrossFit Kids para el mes REAL
    indicado (`facturacion_kids_mensual`) y reparte su importe entre las
    semanas según la fecha real de cada clase (`_repartir_kids_en_semanas`).
    Devuelve el precio por clase de ese mes."""
    if facturacion_total_kids <= 0:
        raise ValueError("La facturación de Kids debe ser un importe positivo")

    with conectar(ruta) as conexion:
        conexion.execute(
            "INSERT INTO facturacion_kids_mensual (anio, mes, importe) VALUES (?, ?, ?) "
            "ON CONFLICT(anio, mes) DO UPDATE SET importe = excluded.importe",
            (anio, mes, facturacion_total_kids),
        )
        _repartir_kids_en_semanas(conexion)
        return precio_sesion_kids(anio, mes, conexion=conexion)


def registrar_ajuste_mensual(
    anio: int,
    mes: int,
    importe: float,
    horas: int,
    motivo: str,
    origen: str = "legacy",
    ruta: Path = RUTA_POR_DEFECTO,
    conexion: sqlite3.Connection | None = None,
) -> None:
    """Guarda (o actualiza) un ajuste explícito para un mes real.

    Sirve para conservar facturación anterior al registro de fechas
    (2026-07-22): sesiones que se cobraron de verdad pero cuya fecha exacta
    nunca quedó guardada, y que por tanto el cálculo desde
    `historial_sesiones` no puede ver. Un importe de 0 borra el ajuste, para
    que recalcularlos sea idempotente."""
    if not motivo.strip():
        raise ValueError("Un ajuste mensual debe llevar un motivo escrito")

    def _hacer(conexion: sqlite3.Connection) -> None:
        if importe == 0 and horas == 0:
            conexion.execute(
                "DELETE FROM ajustes_mensuales WHERE anio = ? AND mes = ? AND origen = ?", (anio, mes, origen)
            )
            return
        conexion.execute(
            "INSERT INTO ajustes_mensuales (anio, mes, origen, importe, horas, motivo) VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(anio, mes, origen) DO UPDATE SET "
            "importe = excluded.importe, horas = excluded.horas, motivo = excluded.motivo",
            (anio, mes, origen, importe, horas, motivo.strip()),
        )

    if conexion is not None:
        _hacer(conexion)
    else:
        with conectar(ruta) as conexion:
            _hacer(conexion)


def listar_ajustes_mensuales(ruta: Path = RUTA_POR_DEFECTO) -> list[dict]:
    """Todos los ajustes mensuales guardados, del mes más reciente al más
    antiguo — para poder revisarlos y documentarlos."""
    if not ruta.exists():
        return []
    with conectar(ruta) as conexion:
        filas = conexion.execute(
            "SELECT anio, mes, origen, importe, horas, motivo FROM ajustes_mensuales "
            "ORDER BY anio DESC, mes DESC, origen"
        ).fetchall()
    return [dict(fila) for fila in filas]


def _fila_semana_a_dict(fila: sqlite3.Row) -> dict:
    """CrossFit Kids solo entra en "Horas" y en la facturación una vez se
    conoce su importe mensual (decisión de Fernando del 2026-07-21: mezclarlo
    en "Horas" antes de tener su facturación real daba un número que no
    cuadraba con lo que él esperaba).

    Sus HORAS sí se suman en cuanto hay facturación — antes no se sumaban
    nunca, ni con el importe ya introducido, así que el precio medio por hora
    de la semana salía inflado (misma incoherencia que se corrigió en la
    vista mensual; segunda auditoría, 2026-07-30). Cuando hay clases de Kids
    sin importe todavía, la semana se marca `provisional`."""
    facturacion_kids = fila["facturacion_kids"]
    sesiones_kids = fila["sesiones_kids"] or 0
    provisional = sesiones_kids > 0 and facturacion_kids is None

    horas_totales = fila["horas_pt_lidomare"] + (sesiones_kids if facturacion_kids is not None else 0)
    facturacion_total = fila["facturacion_pt_lidomare"] + (facturacion_kids or 0)
    return {
        "fecha_inicio": fila["fecha_inicio"],
        "fecha_fin": fila["fecha_fin"],
        "sesiones_kids": sesiones_kids,
        "facturacion_kids": facturacion_kids,
        "facturacion_total": facturacion_total,
        "horas_totales": horas_totales,
        "precio_medio_hora": facturacion_total / horas_totales if horas_totales else 0.0,
        "provisional": provisional,
    }


def obtener_semana(
    fecha_inicio_iso: str, ruta: Path = RUTA_POR_DEFECTO, conexion: sqlite3.Connection | None = None
) -> dict | None:
    if conexion is not None:
        fila = conexion.execute("SELECT * FROM semanas WHERE fecha_inicio = ?", (fecha_inicio_iso,)).fetchone()
        return _fila_semana_a_dict(fila) if fila else None

    if not ruta.exists():
        return None
    with conectar(ruta) as conexion:
        fila = conexion.execute("SELECT * FROM semanas WHERE fecha_inicio = ?", (fecha_inicio_iso,)).fetchone()
    return _fila_semana_a_dict(fila) if fila else None


def obtener_ultima_semana(ruta: Path = RUTA_POR_DEFECTO) -> dict | None:
    """La última semana cerrada, sea de la semana que sea — a diferencia de
    `obtener_semana`, no depende de qué semana natural es hoy. Es lo que
    Fernando quiere ver en la pestaña "Semana" de Economía: el cierre más
    reciente, aunque hayan pasado unos días sin cerrar la semana en curso."""
    if not ruta.exists():
        return None
    with conectar(ruta) as conexion:
        fila = conexion.execute("SELECT * FROM semanas ORDER BY fecha_inicio DESC LIMIT 1").fetchone()
    return _fila_semana_a_dict(fila) if fila else None


def _calcular_mes_desde_historial(anio: int, mes: int, ruta: Path, conexion: sqlite3.Connection) -> dict:
    """Calcula el resumen económico de un mes REAL directamente desde
    `historial_sesiones` y `clases_grupo` — la fuente de verdad con la
    fecha exacta de cada sesión/clase. Sustituye a agrupar `semanas` por el
    mes del lunes de cada semana, que atribuía sesiones de un mes al
    siguiente/anterior si la semana caía a caballo (bug confirmado y
    corregido en el sprint de integridad, 2026-07-28)."""
    patron_mes = f"{anio:04d}-{mes:02d}-%"

    # Facturación y horas de PT se cuentan por separado a propósito
    # (2026-08-03): son dos cosas distintas y desde que existen las
    # mensualidades ya no coinciden.
    #
    #   - El dinero sale solo de las sesiones que llevan importe.
    #   - Las HORAS salen de TODAS las sesiones firmadas, lleven importe o
    #     no. Una sesión de una mensualidad se ha trabajado igual: su dinero
    #     está en la cuota del mes, no en la sesión.
    #
    # Antes las horas también filtraban por `tarifa IS NOT NULL`. El cambio
    # no altera ningún mes ya cerrado: se comprobó que las 47 sesiones
    # reales existentes llevan todas su tarifa.
    fila_pt = conexion.execute(
        "SELECT COALESCE(SUM(tarifa), 0) AS facturacion, "
        "       COUNT(*) AS horas "
        "FROM historial_sesiones WHERE fecha LIKE ?",
        (patron_mes,),
    ).fetchone()

    # Cuotas fijas del mes (mensualidades). No salen de contar sesiones: se
    # facturan enteras por tener las plazas reservadas.
    fila_cuotas = conexion.execute(
        "SELECT COALESCE(SUM(importe), 0) AS importe, COUNT(*) AS n "
        "FROM cargos_mensuales WHERE anio = ? AND mes = ?",
        (anio, mes),
    ).fetchone()
    facturacion_cuotas = fila_cuotas["importe"]

    fila_lidomare = conexion.execute(
        "SELECT COUNT(*) AS n FROM clases_grupo WHERE tipo = 'lidomare' AND fecha LIKE ?", (patron_mes,)
    ).fetchone()
    horas_lidomare = fila_lidomare["n"]
    facturacion_lidomare = horas_lidomare * TARIFA_CROSSFIT_LIDOMARE

    fila_kids = conexion.execute(
        "SELECT COUNT(*) AS n FROM clases_grupo WHERE tipo = 'kids' AND fecha LIKE ?", (patron_mes,)
    ).fetchone()
    sesiones_kids = fila_kids["n"]

    fila_facturacion_kids = conexion.execute(
        "SELECT importe FROM facturacion_kids_mensual WHERE anio = ? AND mes = ?", (anio, mes)
    ).fetchone()
    facturacion_kids = fila_facturacion_kids["importe"] if fila_facturacion_kids else None

    # Provisional: hay clases de Kids este mes pero todavía no se ha
    # introducido su facturación — el total mostrado no las incluye aún
    # (regla de negocio: la facturación/horas de Kids solo cuentan en el
    # total una vez Fernando introduce el importe mensual).
    provisional = sesiones_kids > 0 and facturacion_kids is None

    # Ajustes explícitos del mes (sesiones facturadas antes de que se
    # registraran fechas, ver `ajustes_mensuales` en basedatos.py). Se suman
    # al total, pero se devuelven también por separado para que la pantalla
    # de Economía pueda mostrarlos como su propia línea con su motivo — la
    # diferencia histórica nunca queda oculta dentro del total.
    ajustes = conexion.execute(
        "SELECT origen, importe, horas, motivo FROM ajustes_mensuales WHERE anio = ? AND mes = ? ORDER BY origen",
        (anio, mes),
    ).fetchall()
    ajuste_importe = sum(fila["importe"] for fila in ajustes)
    ajuste_horas = sum(fila["horas"] for fila in ajustes)

    horas_totales = (
        fila_pt["horas"] + horas_lidomare + (sesiones_kids if facturacion_kids is not None else 0) + ajuste_horas
    )
    facturacion_total = (
        fila_pt["facturacion"] + facturacion_cuotas + facturacion_lidomare
        + (facturacion_kids or 0) + ajuste_importe
    )

    # Desglose por modalidad, para que se vea de dónde sale el dinero del
    # mes. Se calcula al vuelo desde el ciclo al que pertenece cada sesión:
    # no se guarda nada nuevo ni hay un segundo sitio que pueda
    # desincronizarse.
    filas_modalidad = conexion.execute(
        "SELECT COALESCE(pc.modalidad, 'bono') AS modalidad, "
        "       COUNT(*) AS horas, COALESCE(SUM(h.tarifa), 0) AS facturacion "
        "FROM historial_sesiones h "
        "LEFT JOIN programas_cliente pc "
        "       ON pc.cliente = h.cliente AND pc.ciclo_bono = h.ciclo_bono "
        "WHERE h.fecha LIKE ? GROUP BY 1",
        (patron_mes,),
    ).fetchall()
    por_modalidad = {
        fila["modalidad"]: {"horas": fila["horas"], "facturacion": fila["facturacion"]}
        for fila in filas_modalidad
    }
    # La facturación de una mensualidad no está en sus sesiones, sino en su
    # cuota: se le suma aquí para que la línea del desglose diga la verdad.
    if facturacion_cuotas:
        entrada = por_modalidad.setdefault("mensualidad", {"horas": 0, "facturacion": 0.0})
        entrada["facturacion"] += facturacion_cuotas

    return {
        "anio": anio,
        "mes": mes,
        "facturacion_total": facturacion_total,
        "horas_totales": horas_totales,
        "precio_medio_hora": facturacion_total / horas_totales if horas_totales else 0.0,
        "facturacion_cuotas": facturacion_cuotas,
        "cuotas": fila_cuotas["n"],
        "por_modalidad": por_modalidad,
        "sesiones_kids": sesiones_kids,
        "facturacion_kids": facturacion_kids,
        "provisional": provisional,
        "ajuste_importe": ajuste_importe,
        "ajuste_horas": ajuste_horas,
        "ajustes": [dict(fila) for fila in ajustes],
    }


def listar_meses(ruta: Path = RUTA_POR_DEFECTO) -> list[dict]:
    """Un resumen por cada mes real con al menos una sesión/clase, del más
    reciente al más antiguo — el historial mensual de Economía. Calculado
    directamente desde `historial_sesiones`/`clases_grupo` por la fecha
    real de cada fila, no por el mes del lunes de cada semana (ver
    docstring del módulo)."""
    if not ruta.exists():
        return []
    with conectar(ruta) as conexion:
        meses_pt = conexion.execute(
            "SELECT DISTINCT substr(fecha, 1, 4) AS anio, substr(fecha, 6, 2) AS mes FROM historial_sesiones"
        ).fetchall()
        meses_grupo = conexion.execute(
            "SELECT DISTINCT substr(fecha, 1, 4) AS anio, substr(fecha, 6, 2) AS mes FROM clases_grupo"
        ).fetchall()
        # Un mes puede existir solo por su ajuste legacy: facturación real
        # de antes del registro de fechas, sin ninguna fila de historial que
        # la respalde. No incluirlo aquí lo haría desaparecer del histórico.
        meses_ajuste = conexion.execute("SELECT DISTINCT anio, mes FROM ajustes_mensuales").fetchall()
        # Un mes puede existir solo por la cuota de una mensualidad, sin
        # ninguna sesión firmada todavía (el cliente paga por adelantado).
        meses_cuota = conexion.execute("SELECT DISTINCT anio, mes FROM cargos_mensuales").fetchall()
        claves = (
            {(int(f["anio"]), int(f["mes"])) for f in meses_pt}
            | {(int(f["anio"]), int(f["mes"])) for f in meses_grupo}
            | {(f["anio"], f["mes"]) for f in meses_ajuste}
            | {(f["anio"], f["mes"]) for f in meses_cuota}
        )

        return [
            _calcular_mes_desde_historial(anio, mes, ruta, conexion)
            for anio, mes in sorted(claves, reverse=True)
        ]


def obtener_mes(anio: int, mes: int, ruta: Path = RUTA_POR_DEFECTO) -> dict | None:
    """Resumen económico de un mes real concreto — ver docstring del
    módulo y de `_calcular_mes_desde_historial`. Devuelve `None` solo si no
    hay ninguna sesión de PT ni clase de grupo registrada ese mes (para no
    mostrar un mes completamente vacío como si tuviera datos)."""
    if not ruta.exists():
        return None
    with conectar(ruta) as conexion:
        resultado = _calcular_mes_desde_historial(anio, mes, ruta, conexion)
        hay_datos = conexion.execute(
            "SELECT EXISTS(SELECT 1 FROM historial_sesiones WHERE substr(fecha,1,4)=? AND substr(fecha,6,2)=?) "
            "OR EXISTS(SELECT 1 FROM clases_grupo WHERE substr(fecha,1,4)=? AND substr(fecha,6,2)=?) "
            "OR EXISTS(SELECT 1 FROM ajustes_mensuales WHERE anio=? AND mes=?) "
            "OR EXISTS(SELECT 1 FROM cargos_mensuales WHERE anio=? AND mes=?) AS hay",
            (f"{anio:04d}", f"{mes:02d}", f"{anio:04d}", f"{mes:02d}", anio, mes, anio, mes),
        ).fetchone()["hay"]
    return resultado if hay_datos else None
