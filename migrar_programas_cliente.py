"""Reconstruye los bonos concretos que ha tenido cada cliente
(`programas_cliente`), a partir del historial que ya existe (2026-08-02).

Por qué: hasta ahora el historial solo sabía "esta sesión fue del programa
Nuevo 45 € ×4". Si un cliente contrata tres veces seguidas ese mismo bono,
agrupar por nombre los mezclaría. Cada contratación concreta necesita su
propia ficha.

Cómo, sin inventar nada:

- El corte entre bonos ya lo marca `ciclo_bono`, que cada sesión guarda
  desde el sprint de integridad del 2026-07-28. Si algún dato antiguo
  todavía no lo tiene bien repartido, `migrar_ciclo_bono.py` lo reconstruye
  antes (detecta los reinicios de numeración).
- La tarifa de cada bono es la que llevan sus propias sesiones — la tarifa
  HISTÓRICA, no la actual del cliente. Si la tarifa cambió desde entonces,
  el bono viejo conserva la suya.
- `fecha_inicio` y `fecha_fin` salen de la primera y la última sesión
  registradas de ese bono. El bono en curso no tiene fecha de fin.
- `pagado` se deja en NULL para los bonos antiguos: nunca se guardó el pago
  por bono, solo el del cliente, y no se va a suponer. A partir de ahora sí
  queda registrado en cada renovación.

Un cliente sin ninguna sesión registrada tiene igualmente su bono actual
(el que le asignó Fernando al darlo de alta), sin fechas.

Es seguro ejecutarlo varias veces: solo rellena lo que falta y actualiza
las fechas del bono en curso, nunca borra ni duplica.

Uso:
    python migrar_programas_cliente.py [ruta_bd] [--aplicar]

Sin `--aplicar` solo muestra lo que haría.
"""

import sys
from pathlib import Path

from basedatos import RUTA_POR_DEFECTO, conectar, crear_esquema, transaccion


def calcular(ruta: Path = RUTA_POR_DEFECTO) -> tuple[list[dict], list[str]]:
    """Devuelve (bonos, avisos) sin escribir nada."""
    # Se asegura el esquema antes de leer: este script puede ejecutarse
    # contra una base que todavía no tiene la tabla nueva.
    crear_esquema(ruta)

    bonos: list[dict] = []
    avisos: list[str] = []

    with conectar(ruta) as conexion:
        clientes = conexion.execute(
            "SELECT c.nombre, c.ciclo_bono, c.tipo_programa, c.pendiente_pago, "
            "       p.tarifa, p.sesiones_totales "
            "FROM clientes c LEFT JOIN programas p ON p.nombre = c.tipo_programa "
            "ORDER BY c.nombre"
        ).fetchall()

        for cliente in clientes:
            nombre = cliente["nombre"]
            ciclo_actual = cliente["ciclo_bono"]

            ciclos = conexion.execute(
                "SELECT ciclo_bono, MIN(fecha) AS desde, MAX(fecha) AS hasta, "
                "       COUNT(*) AS sesiones, MAX(sesiones_totales) AS totales, "
                "       MAX(tipo_programa) AS tipo, MAX(tarifa) AS tarifa "
                "FROM historial_sesiones WHERE cliente = ? GROUP BY ciclo_bono ORDER BY ciclo_bono",
                (nombre,),
            ).fetchall()

            vistos = set()
            for ciclo in ciclos:
                es_actual = ciclo["ciclo_bono"] == ciclo_actual
                vistos.add(ciclo["ciclo_bono"])

                # Si un bono antiguo tiene varias tarifas distintas entre sus
                # sesiones, no se elige una a ojo: se avisa.
                distintas = conexion.execute(
                    "SELECT COUNT(DISTINCT tarifa) AS n FROM historial_sesiones "
                    "WHERE cliente = ? AND ciclo_bono = ? AND tarifa IS NOT NULL",
                    (nombre, ciclo["ciclo_bono"]),
                ).fetchone()["n"]
                if distintas > 1:
                    avisos.append(
                        f"'{nombre}', bono {ciclo['ciclo_bono']}: sus sesiones tienen {distintas} tarifas "
                        f"distintas. Se guarda la mayor; revísalo si no es lo esperado."
                    )

                bonos.append({
                    "cliente": nombre,
                    "ciclo_bono": ciclo["ciclo_bono"],
                    "tipo_programa": ciclo["tipo"] or cliente["tipo_programa"],
                    "tarifa": ciclo["tarifa"] if ciclo["tarifa"] is not None else cliente["tarifa"],
                    "sesiones_totales": ciclo["totales"] or cliente["sesiones_totales"] or 0,
                    "fecha_inicio": ciclo["desde"],
                    # El bono en curso sigue abierto: no tiene fecha de fin.
                    "fecha_fin": None if es_actual else ciclo["hasta"],
                    # Solo se sabe el pago del bono EN CURSO (vive en
                    # `clientes.pendiente_pago`). De los antiguos nunca se
                    # guardó, así que queda desconocido.
                    "pagado": (0 if cliente["pendiente_pago"] else 1) if es_actual else None,
                    "sesiones": ciclo["sesiones"],
                })

            # Un cliente puede estar en un bono del que todavía no ha hecho
            # ninguna sesión (recién dado de alta, o recién renovado).
            if ciclo_actual not in vistos:
                bonos.append({
                    "cliente": nombre,
                    "ciclo_bono": ciclo_actual,
                    "tipo_programa": cliente["tipo_programa"],
                    "tarifa": cliente["tarifa"],
                    "sesiones_totales": cliente["sesiones_totales"] or 0,
                    "fecha_inicio": None,
                    "fecha_fin": None,
                    "pagado": 0 if cliente["pendiente_pago"] else 1,
                    "sesiones": 0,
                })

    return bonos, avisos


def aplicar(ruta: Path = RUTA_POR_DEFECTO) -> dict:
    """Escribe los bonos calculados. Idempotente: vuelve a dejar los mismos
    valores si se ejecuta otra vez, sin borrar ni duplicar filas."""
    bonos, avisos = calcular(ruta)

    with transaccion(ruta) as conexion:
        for bono in bonos:
            conexion.execute(
                "INSERT INTO programas_cliente "
                "(cliente, ciclo_bono, tipo_programa, tarifa, sesiones_totales, fecha_inicio, fecha_fin, pagado) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(cliente, ciclo_bono) DO UPDATE SET "
                "  tipo_programa = excluded.tipo_programa, "
                "  tarifa = excluded.tarifa, "
                "  sesiones_totales = excluded.sesiones_totales, "
                "  fecha_inicio = excluded.fecha_inicio, "
                "  fecha_fin = excluded.fecha_fin, "
                # El pago de un bono ya cerrado NO se pisa: si alguien lo
                # anotó a mano, se respeta.
                "  pagado = COALESCE(excluded.pagado, programas_cliente.pagado)",
                (
                    bono["cliente"], bono["ciclo_bono"], bono["tipo_programa"], bono["tarifa"],
                    bono["sesiones_totales"], bono["fecha_inicio"], bono["fecha_fin"], bono["pagado"],
                ),
            )

    return {"bonos": bonos, "avisos": avisos}


def rellenar_si_falta(ruta: Path = RUTA_POR_DEFECTO) -> int:
    """Reconstruye los bonos SOLO si todavía no hay ninguno registrado.

    Pensada para llamarse al arrancar la web (igual que `asegurar_tokens`):
    un servidor que se actualiza a esta versión se migra él solo la primera
    vez que recarga, sin que nadie tenga que entrar a ejecutar nada a mano.
    A partir de ahí no vuelve a hacer nada — los bonos ya los mantiene al
    día el propio flujo de firmar y renovar.

    Devuelve cuántos bonos ha registrado (0 si no había nada que hacer)."""
    if not ruta.exists():
        return 0

    with conectar(ruta) as conexion:
        ya_hay = conexion.execute("SELECT EXISTS(SELECT 1 FROM programas_cliente) AS hay").fetchone()["hay"]
        hay_clientes = conexion.execute("SELECT EXISTS(SELECT 1 FROM clientes) AS hay").fetchone()["hay"]
    if ya_hay or not hay_clientes:
        return 0

    return len(aplicar(ruta)["bonos"])


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    argumentos = [a for a in sys.argv[1:] if not a.startswith("--")]
    ruta = Path(argumentos[0]) if argumentos else RUTA_POR_DEFECTO
    solo_ver = "--aplicar" not in sys.argv

    bonos, avisos = calcular(ruta)

    print(f"Bonos que quedarían registrados: {len(bonos)}\n")
    actual = None
    for bono in bonos:
        if bono["cliente"] != actual:
            actual = bono["cliente"]
            print(f"  {actual}")
        estado = "EN CURSO" if bono["fecha_fin"] is None else f"hasta {bono['fecha_fin']}"
        desde = bono["fecha_inicio"] or "sin sesiones aún"
        print(
            f"      bono {bono['ciclo_bono']}: {bono['tipo_programa']} "
            f"({bono['tarifa']}€ ×{bono['sesiones_totales']}) · desde {desde} · {estado} "
            f"· {bono['sesiones']} sesiones"
        )

    if avisos:
        print("\nA revisar (no se adivina nada):")
        for aviso in avisos:
            print(f"  - {aviso}")

    if solo_ver:
        print("\n(previsualización — nada guardado; vuelve a ejecutarlo con --aplicar)")
        return

    aplicar(ruta)
    print("\nBonos guardados.")


if __name__ == "__main__":
    main()
