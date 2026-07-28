"""Registro histórico de facturación, consultable por semana o por mes en
cualquier momento.

Desde el 2026-07-18, esto es SQLite (`datos/antifragil.db`, ver
`basedatos.py`) — antes era un Excel. Se mantienen las mismas funciones
públicas que ya usaban `cierre_semanal/` y `economia/cli.py`.

Dos tablas:
- `semanas`: una fila por semana cerrada.
- `desglose`: una fila por (semana, tarifa) — el detalle por tarifa que
  antes llevaba Fernando a mano en su propia hoja de cálculo.

A diferencia de la versión en Excel, **no hace falta guardar aparte los
totales del mes**: con SQL se suman las semanas de un mes al vuelo
(`SUM(...) GROUP BY`) cada vez que se preguntan, así que no hay un total
guardado que se pueda quedar desactualizado.

CrossFit Kids se registra sin facturación hasta que Fernando indica el
importe mensual (`registrar_facturacion_kids`), momento en el que se
reparte hacia atrás sobre las semanas de ese mes (importe ÷ sesiones del
mes = precio por sesión; cada semana se multiplica por sus sesiones).
"""

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
) -> None:
    """Guarda (o actualiza, si ya existía) el resultado económico de una
    semana. `desglose`: {tarifa: {"sesiones": n, "facturacion": importe}}
    — formato que devuelve `economia.calculo.calcular_desglose`."""
    resumen = resumir(desglose)
    anio, mes = fecha_inicio.year, fecha_inicio.month
    clave = fecha_inicio.isoformat()

    with conectar(ruta) as conexion:
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


def obtener_desglose_semana(fecha_inicio_iso: str, ruta: Path = RUTA_POR_DEFECTO) -> dict[float, dict]:
    """El desglose por tarifa ya guardado de una semana — para sumarle un
    día nuevo antes de volver a guardar (ver actualización diaria en
    `webapp/app.py`, ruta `/admin/procesar-dia`)."""
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
    del 2026-07-23, tras detectar un descuadre así con Felipe y Javi. Nunca
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


def registrar_facturacion_kids(anio: int, mes: int, facturacion_total_kids: float, ruta: Path = RUTA_POR_DEFECTO) -> float:
    """Reparte la facturación mensual de CrossFit Kids entre las semanas de
    ese mes, proporcionalmente a las sesiones de cada semana. Devuelve el
    precio por sesión."""
    with conectar(ruta) as conexion:
        sesiones_kids_mes = conexion.execute(
            "SELECT COALESCE(SUM(sesiones_kids), 0) AS total FROM semanas WHERE anio = ? AND mes = ?", (anio, mes)
        ).fetchone()["total"]

        if not sesiones_kids_mes:
            raise ValueError(f"No hay sesiones de CrossFit Kids registradas para {mes}/{anio}.")

        precio_sesion = facturacion_total_kids / sesiones_kids_mes

        conexion.execute(
            "UPDATE semanas SET facturacion_kids = sesiones_kids * ? WHERE anio = ? AND mes = ?",
            (precio_sesion, anio, mes),
        )

    return precio_sesion


def _fila_semana_a_dict(fila: sqlite3.Row) -> dict:
    """CrossFit Kids se muestra aparte (sesiones_kids/facturacion_kids) — no
    entra en "Horas" ni en la facturación principal hasta que se conoce su
    importe mensual (decisión de Fernando del 2026-07-21: mezclarlo en
    "Horas" antes de tener su facturación real daba un número que no
    cuadraba con lo que él esperaba)."""
    facturacion_kids = fila["facturacion_kids"] or 0
    horas_totales = fila["horas_pt_lidomare"]
    facturacion_total = fila["facturacion_pt_lidomare"] + facturacion_kids
    return {
        "fecha_inicio": fila["fecha_inicio"],
        "fecha_fin": fila["fecha_fin"],
        "sesiones_kids": fila["sesiones_kids"],
        "facturacion_kids": fila["facturacion_kids"],
        "facturacion_total": facturacion_total,
        "horas_totales": horas_totales,
        "precio_medio_hora": facturacion_total / horas_totales if horas_totales else 0.0,
    }


def obtener_semana(fecha_inicio_iso: str, ruta: Path = RUTA_POR_DEFECTO) -> dict | None:
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


def listar_meses(ruta: Path = RUTA_POR_DEFECTO) -> list[dict]:
    """Un resumen por cada mes con al menos una semana cerrada, del más
    reciente al más antiguo — el historial mensual de Economía. Cada
    semana cuenta para el mes de su `fecha_inicio` — si una semana cae a
    caballo entre dos meses, se registra ya recortada a las fechas reales
    del mes que corresponda (ver `registrar_semana`), así que no hace
    falta repartir nada aquí."""
    if not ruta.exists():
        return []
    with conectar(ruta) as conexion:
        filas = conexion.execute(
            """
            SELECT
                anio, mes,
                COALESCE(SUM(facturacion_pt_lidomare), 0) AS facturacion_pt_lidomare,
                COALESCE(SUM(horas_pt_lidomare), 0) AS horas_pt_lidomare
            FROM semanas GROUP BY anio, mes ORDER BY anio DESC, mes DESC
            """
        ).fetchall()

    meses = []
    for fila in filas:
        facturacion_total = fila["facturacion_pt_lidomare"]
        horas_totales = fila["horas_pt_lidomare"]
        meses.append(
            {
                "anio": fila["anio"],
                "mes": fila["mes"],
                "facturacion_total": facturacion_total,
                "horas_totales": horas_totales,
                "precio_medio_hora": facturacion_total / horas_totales if horas_totales else 0.0,
            }
        )
    return meses


def obtener_mes(anio: int, mes: int, ruta: Path = RUTA_POR_DEFECTO) -> dict | None:
    if not ruta.exists():
        return None
    with conectar(ruta) as conexion:
        fila = conexion.execute(
            """
            SELECT
                COALESCE(SUM(facturacion_pt_lidomare), 0) AS facturacion_pt_lidomare,
                COALESCE(SUM(horas_pt_lidomare), 0) AS horas_pt_lidomare,
                COALESCE(SUM(sesiones_kids), 0) AS sesiones_kids,
                SUM(facturacion_kids) AS facturacion_kids,
                COUNT(*) AS num_semanas
            FROM semanas WHERE anio = ? AND mes = ?
            """,
            (anio, mes),
        ).fetchone()

    if not fila or not fila["num_semanas"]:
        return None

    horas_totales = fila["horas_pt_lidomare"]
    facturacion_total = fila["facturacion_pt_lidomare"]
    return {
        "facturacion_total": facturacion_total,
        "horas_totales": horas_totales,
        "precio_medio_hora": facturacion_total / horas_totales if horas_totales else 0.0,
        "sesiones_kids": fila["sesiones_kids"],
        "facturacion_kids": fila["facturacion_kids"],
    }
