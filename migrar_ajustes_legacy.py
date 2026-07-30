"""Conserva la facturación histórica que el cálculo por fechas no puede ver
(segunda auditoría, 2026-07-30).

El problema real, medido sobre una copia de producción del 2026-07-30:

- La vista mensual se calcula desde `historial_sesiones` (fecha real de cada
  sesión), que es lo correcto de aquí en adelante.
- Pero el historial anterior al 2026-07-22 (cuando empezó la firma manual)
  está incompleto: hay sesiones que SÍ se facturaron y cobraron, y cuya
  fecha exacta nunca quedó registrada. El caso confirmado es un cliente cuyo
  historial salta de la sesión 9 a la 12.
- Resultado: calcular julio solo desde el historial daba 112,50 € y 3 horas
  MENOS que el cierre que ya se había dado por bueno.

Este script NO inventa fechas. Compara, semana a semana, las sesiones
guardadas en `desglose` (la economía que Fernando cerró) contra las que de
verdad tienen fila en `historial_sesiones`, y guarda la diferencia como un
ajuste mensual explícito (`ajustes_mensuales`), con su motivo, visible como
línea propia en la pantalla de Economía.

Reglas:

- Solo mira semanas que caen ENTERAS dentro de un mismo mes. Si una semana
  con diferencia cruza dos meses, no reparte a ojo: deja un aviso para que
  Fernando decida (regla explícita: avisar en vez de adivinar).
- Es seguro ejecutarlo varias veces: recalcula el ajuste de origen 'legacy'
  desde cero en cada pasada, así que no se acumula.
- No toca ninguna sesión, ni ningún bono, ni la vista semanal.

Uso:
    python migrar_ajustes_legacy.py [ruta_bd] [--aplicar]

Sin `--aplicar` solo muestra lo que haría (previsualización).
"""

import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

from avisos import registrar_aviso
from basedatos import RUTA_POR_DEFECTO, conectar
from economia.calculo import TARIFA_CROSSFIT_LIDOMARE
from economia.registro import registrar_ajuste_mensual

ORIGEN = "legacy"


def calcular_ajustes(ruta: Path = RUTA_POR_DEFECTO) -> tuple[dict[tuple[int, int], dict], list[str]]:
    """Devuelve ({(anio, mes): {importe, horas, detalle}}, ambiguedades).

    `detalle` describe de dónde sale cada diferencia, para poder escribirlo
    como motivo del ajuste y que quede documentado."""
    ajustes: dict[tuple[int, int], dict] = defaultdict(lambda: {"importe": 0.0, "horas": 0, "detalle": []})
    ambiguedades: list[str] = []

    with conectar(ruta) as conexion:
        semanas = conexion.execute("SELECT fecha_inicio, fecha_fin FROM semanas ORDER BY fecha_inicio").fetchall()

        for semana in semanas:
            inicio, fin = semana["fecha_inicio"], semana["fecha_fin"]

            guardado = {
                fila["tarifa"]: fila["sesiones"]
                for fila in conexion.execute(
                    "SELECT tarifa, sesiones FROM desglose WHERE fecha_inicio_semana = ?", (inicio,)
                )
            }
            real = {
                fila["tarifa"]: fila["n"]
                for fila in conexion.execute(
                    "SELECT tarifa, COUNT(*) AS n FROM historial_sesiones "
                    "WHERE fecha BETWEEN ? AND ? AND tarifa IS NOT NULL GROUP BY tarifa",
                    (inicio, fin),
                )
            }

            # La tarifa de CrossFit Lidomare vive en `desglose` pero no viene
            # de `historial_sesiones` (se compara aparte contra
            # `clases_grupo`), así que aquí solo generaría ruido.
            faltantes = {
                tarifa: guardado.get(tarifa, 0) - real.get(tarifa, 0)
                for tarifa in (set(guardado) | set(real)) - {TARIFA_CROSSFIT_LIDOMARE}
            }
            faltantes = {tarifa: n for tarifa, n in faltantes.items() if n > 0}
            if not faltantes:
                continue

            inicio_d, fin_d = date.fromisoformat(inicio), date.fromisoformat(fin)
            if (inicio_d.year, inicio_d.month) != (fin_d.year, fin_d.month):
                for tarifa, n in sorted(faltantes.items()):
                    ambiguedades.append(
                        f"La semana del {inicio} al {fin} cruza dos meses y tiene {n} sesiones de "
                        f"{tarifa}€ facturadas sin fecha en el historial — no se reparte automáticamente, "
                        f"decide tú a qué mes pertenecen"
                    )
                continue

            clave = (inicio_d.year, inicio_d.month)
            for tarifa, n in sorted(faltantes.items()):
                ajustes[clave]["importe"] += n * tarifa
                ajustes[clave]["horas"] += n
                ajustes[clave]["detalle"].append(f"{n} sesiones de {tarifa:.2f}€ en la semana del {inicio}")

    return dict(ajustes), ambiguedades


def aplicar(ruta: Path = RUTA_POR_DEFECTO) -> dict:
    """Guarda los ajustes calculados y registra un aviso por cada caso
    ambiguo. Idempotente: los ajustes de origen 'legacy' se recalculan
    enteros, no se suman a los que ya hubiera."""
    ajustes, ambiguedades = calcular_ajustes(ruta)

    with conectar(ruta) as conexion:
        conexion.execute("DELETE FROM ajustes_mensuales WHERE origen = ?", (ORIGEN,))

    for (anio, mes), datos in sorted(ajustes.items()):
        motivo = (
            "Sesiones facturadas antes del registro de fechas (2026-07-22), sin fila en el historial: "
            + "; ".join(datos["detalle"])
        )
        registrar_ajuste_mensual(anio, mes, datos["importe"], datos["horas"], motivo, ORIGEN, ruta)

    for detalle in ambiguedades:
        registrar_aviso(date.today().isoformat(), "ajuste_legacy_ambiguo", detalle, ruta)

    return {"ajustes": ajustes, "ambiguedades": ambiguedades}


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    argumentos = [a for a in sys.argv[1:] if not a.startswith("--")]
    ruta = Path(argumentos[0]) if argumentos else RUTA_POR_DEFECTO
    solo_ver = "--aplicar" not in sys.argv

    ajustes, ambiguedades = calcular_ajustes(ruta)

    if not ajustes and not ambiguedades:
        print("No hay facturación histórica sin fila en el historial: no hace falta ningún ajuste.")
        return

    print("Ajustes mensuales que conservan la facturación histórica:")
    for (anio, mes), datos in sorted(ajustes.items()):
        print(f"  {anio}-{mes:02d}: +{datos['importe']:.2f} € y +{datos['horas']} h")
        for detalle in datos["detalle"]:
            print(f"      - {detalle}")

    if ambiguedades:
        print("\nCasos que NO se ajustan automáticamente (quedarán como aviso):")
        for detalle in ambiguedades:
            print(f"  - {detalle}")

    if solo_ver:
        print("\n(previsualización — nada guardado; vuelve a ejecutarlo con --aplicar)")
        return

    aplicar(ruta)
    print("\nAjustes guardados.")


if __name__ == "__main__":
    main()
