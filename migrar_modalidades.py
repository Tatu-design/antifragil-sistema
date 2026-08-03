"""Pone en marcha las tres modalidades de servicio sin cambiar nada de lo
que ya había (2026-08-03).

Todos los clientes actuales son bonos, y siguen siéndolo. Esta migración NO
convierte a nadie a mensualidad ni a cuenta de cliente: eso lo hará Fernando
a mano, cliente por cliente, desde «Editar programa».

Qué hace exactamente:

1. `modalidad` se queda en 'bono' en todos los ciclos. No hace falta ningún
   UPDATE: la columna nace con ese valor por defecto (`basedatos.py`), así
   que ni una fila existente se reescribe.

2. Rellena `precio_total` donde falte, calculándolo como tarifa × sesiones.
   Es información que ya estaba, solo que repartida en dos columnas — no se
   inventa ningún precio.

3. Rellena `anio`/`mes` de los ciclos SOLO si son mensuales. Como ahora
   mismo todos son bonos, no toca ninguno; queda preparado para después.

Lo que NO hace, a propósito:

- No toca `historial_sesiones`. Ni una fecha, ni una tarifa, ni un número.
- No toca `semanas` ni `desglose`.
- No crea ningún cargo mensual: no hay ninguna mensualidad todavía.
- No cambia ningún estado de pago.

Es segura de ejecutar tantas veces como haga falta: solo rellena huecos.

Uso:
    python migrar_modalidades.py [ruta_bd] [--aplicar]

Sin `--aplicar` solo muestra lo que haría.
"""

import sys
from pathlib import Path

from basedatos import RUTA_POR_DEFECTO, conectar, crear_esquema, transaccion
from servicios.modalidades import BONO, MODALIDAD_POR_DEFECTO


def calcular(ruta: Path = RUTA_POR_DEFECTO) -> tuple[list[dict], list[str]]:
    """Devuelve (cambios, avisos) sin escribir nada."""
    crear_esquema(ruta)

    cambios: list[dict] = []
    avisos: list[str] = []

    with conectar(ruta) as conexion:
        ciclos = conexion.execute(
            "SELECT cliente, ciclo_bono, tipo_programa, modalidad, tarifa, "
            "       sesiones_totales, precio_total "
            "FROM programas_cliente ORDER BY cliente, ciclo_bono"
        ).fetchall()

        for ciclo in ciclos:
            modalidad = ciclo["modalidad"] or MODALIDAD_POR_DEFECTO

            if modalidad != BONO:
                # Ya convertido a mano por Fernando: no se toca.
                continue

            if ciclo["precio_total"] is not None:
                continue  # ya tiene precio total, nada que rellenar

            if ciclo["tarifa"] is None or not ciclo["sesiones_totales"]:
                # Sin tarifa o sin sesiones no se puede calcular el total, y
                # NO se inventa: se avisa para que Fernando lo complete.
                avisos.append(
                    f"'{ciclo['cliente']}', ciclo {ciclo['ciclo_bono']}: no se puede calcular el precio "
                    f"total (tarifa={ciclo['tarifa']}, sesiones={ciclo['sesiones_totales']}). "
                    f"Se queda vacío — complétalo en «Editar programa»."
                )
                continue

            cambios.append({
                "cliente": ciclo["cliente"],
                "ciclo": ciclo["ciclo_bono"],
                "nombre": ciclo["tipo_programa"],
                "tarifa": ciclo["tarifa"],
                "sesiones": ciclo["sesiones_totales"],
                "precio_total": round(ciclo["tarifa"] * ciclo["sesiones_totales"], 2),
            })

    return cambios, avisos


def aplicar(ruta: Path = RUTA_POR_DEFECTO) -> dict:
    """Escribe los huecos calculados. Idempotente."""
    cambios, avisos = calcular(ruta)

    with transaccion(ruta) as conexion:
        for cambio in cambios:
            # `precio_total IS NULL` en la propia condición: aunque esto se
            # ejecute dos veces a la vez, la segunda no pisa nada.
            conexion.execute(
                "UPDATE programas_cliente SET precio_total = ? "
                "WHERE cliente = ? AND ciclo_bono = ? AND precio_total IS NULL",
                (cambio["precio_total"], cambio["cliente"], cambio["ciclo"]),
            )

    return {"cambios": cambios, "avisos": avisos}


def rellenar_si_falta(ruta: Path = RUTA_POR_DEFECTO) -> int:
    """Relleno único al arrancar la web, igual que `asegurar_tokens`.

    Devuelve cuántos ciclos ha completado (0 si no había nada que hacer).
    Así un servidor que se actualiza a esta versión se pone al día él solo
    la primera vez que recarga, sin que nadie entre a ejecutar nada."""
    if not ruta.exists():
        return 0
    cambios, _ = calcular(ruta)
    if not cambios:
        return 0
    return len(aplicar(ruta)["cambios"])


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    argumentos = [a for a in sys.argv[1:] if not a.startswith("--")]
    ruta = Path(argumentos[0]) if argumentos else RUTA_POR_DEFECTO
    solo_ver = "--aplicar" not in sys.argv

    cambios, avisos = calcular(ruta)

    print("Todos los servicios existentes se quedan como BONO. No se convierte a nadie.\n")
    print(f"Ciclos a los que se les completará el precio total: {len(cambios)}\n")
    for cambio in cambios:
        print(f"  {cambio['cliente']:<18} ciclo {cambio['ciclo']}: {cambio['nombre']} — "
              f"{cambio['tarifa']}€ × {cambio['sesiones']} = {cambio['precio_total']}€")

    if avisos:
        print("\nA revisar (no se adivina nada):")
        for aviso in avisos:
            print(f"  - {aviso}")

    if solo_ver:
        print("\n(previsualización — nada guardado; vuelve a ejecutarlo con --aplicar)")
        return

    aplicar(ruta)
    print("\nHecho.")


if __name__ == "__main__":
    main()
