"""Reconstruye el ciclo de bono real de cada sesión ya guardada
(segunda auditoría, 2026-07-30).

El problema: cuando se añadió la columna `ciclo_bono` (2026-07-28), todas
las filas existentes se marcaron como ciclo 1. Eso no distingue los bonos
que ya se habían renovado ANTES de esa fecha: un cliente con dos bonos
completos tenía sus 24 sesiones marcadas como si fueran del mismo bono. Con
eso, borrar una sesión del bono actual podía hacer que el contador
"completadas" volviera a mostrar el número del bono anterior — exactamente
el bug que `ciclo_bono` venía a resolver, pero que seguía vivo para los
datos antiguos.

Cómo se reconstruye, sin inventar nada: recorriendo el historial de cada
cliente en orden (fecha, id) y detectando los REINICIOS de numeración. Si
la sesión que sigue a la número 12 es la número 1, ahí empieza un bono
nuevo. Es la misma señal que usa el negocio para saberlo.

Casos ambiguos (numeración que no reinicia limpiamente, saltos hacia atrás
que no empiezan en 1, huecos que podrían esconder un corte de bono): NO se
adivinan. Se deja un aviso para que Fernando lo revise, y esas sesiones se
quedan con el ciclo que ya tenían.

Es seguro ejecutarlo varias veces: recalcula desde el propio historial, no
acumula.

Uso:
    python migrar_ciclo_bono.py [ruta_bd] [--aplicar]

Sin `--aplicar` solo muestra lo que haría.
"""

import sys
from pathlib import Path

from avisos import registrar_aviso
from basedatos import RUTA_POR_DEFECTO, conectar, transaccion
from zona_horaria import hoy_negocio


def _calcular_ciclos(filas: list) -> tuple[dict[int, int], list[str]]:
    """Asigna un ciclo a cada sesión de un cliente, en orden.

    Devuelve ({id_sesion: ciclo}, avisos). Un reinicio de numeración
    (la sesión siguiente tiene un número menor o igual que la anterior)
    marca el comienzo de un bono nuevo."""
    ciclos: dict[int, int] = {}
    avisos: list[str] = []
    ciclo = 1
    numero_anterior = None

    for fila in filas:
        numero = fila["numero_sesion"]

        if numero_anterior is not None and numero <= numero_anterior:
            # Reinicio: empieza un bono nuevo. Lo esperado es que reinicie
            # en 1; si reinicia en otro número, se acepta el corte pero se
            # avisa, porque puede haber sesiones sin registrar por medio.
            ciclo += 1
            if numero != 1:
                avisos.append(
                    f"'{fila['cliente']}': el bono que empieza el {fila['fecha']} arranca en la sesión "
                    f"{numero} en vez de la 1 — revisa si falta alguna sesión por registrar"
                )

        ciclos[fila["id"]] = ciclo
        numero_anterior = numero

    return ciclos, avisos


def calcular(ruta: Path = RUTA_POR_DEFECTO) -> dict:
    """Calcula, sin escribir nada: ciclos por sesión, ciclo actual por
    cliente, avisos por casos ambiguos, y las incoherencias detectadas al
    validar contra `sesiones_completadas` / `pendiente_pago`."""
    cambios_sesiones: dict[int, int] = {}
    ciclo_actual_por_cliente: dict[str, int] = {}
    avisos: list[str] = []

    with conectar(ruta) as conexion:
        clientes = [fila["nombre"] for fila in conexion.execute("SELECT nombre FROM clientes ORDER BY nombre")]

        for cliente in clientes:
            filas = conexion.execute(
                "SELECT id, cliente, fecha, numero_sesion, sesiones_totales, ciclo_bono "
                "FROM historial_sesiones WHERE cliente = ? ORDER BY fecha, id",
                (cliente,),
            ).fetchall()
            if not filas:
                continue

            ciclos, avisos_cliente = _calcular_ciclos(filas)
            avisos.extend(avisos_cliente)

            for fila in filas:
                if ciclos[fila["id"]] != fila["ciclo_bono"]:
                    cambios_sesiones[fila["id"]] = ciclos[fila["id"]]

            ciclo_actual = max(ciclos.values())
            ciclo_actual_por_cliente[cliente] = ciclo_actual

            # Validación contra el estado guardado del cliente. No corrige
            # `sesiones_completadas` ni `pendiente_pago` — solo avisa si no
            # cuadran, para que Fernando lo mire (nunca adivinar).
            estado = conexion.execute(
                "SELECT c.sesiones_completadas, c.pendiente_pago, p.sesiones_totales "
                "FROM clientes c JOIN programas p ON p.nombre = c.tipo_programa WHERE c.nombre = ?",
                (cliente,),
            ).fetchone()
            if estado is None:
                continue

            sesiones_del_ciclo = [f for f in filas if ciclos[f["id"]] == ciclo_actual]
            ultima = max(f["numero_sesion"] for f in sesiones_del_ciclo)
            completadas = estado["sesiones_completadas"]

            # Si la última sesión del ciclo actual completó el bono, el
            # contador del cliente debería estar ya reiniciado a 0 (la
            # renovación lo hace) — cualquier otra combinación es una
            # incoherencia que merece revisión.
            if ultima == estado["sesiones_totales"]:
                if completadas not in (0, ultima):
                    avisos.append(
                        f"'{cliente}': su última sesión registrada completó el bono ({ultima} de "
                        f"{estado['sesiones_totales']}) pero su contador marca {completadas} — revísalo"
                    )
                elif completadas == 0 and not estado["pendiente_pago"]:
                    avisos.append(
                        f"'{cliente}': completó un bono y se renovó, pero no está marcado como "
                        f"pendiente de pago — revísalo"
                    )
            elif completadas != ultima:
                avisos.append(
                    f"'{cliente}': su última sesión registrada es la {ultima} pero su contador marca "
                    f"{completadas} — puede que falten sesiones por registrar"
                )

    return {
        "cambios_sesiones": cambios_sesiones,
        "ciclo_actual_por_cliente": ciclo_actual_por_cliente,
        "avisos": avisos,
    }


def aplicar(ruta: Path = RUTA_POR_DEFECTO) -> dict:
    """Escribe los ciclos reconstruidos y el ciclo actual de cada cliente,
    todo en una única transacción. Registra un aviso por cada caso ambiguo o
    incoherente. Seguro de repetir."""
    resultado = calcular(ruta)

    with transaccion(ruta) as conexion:
        for id_sesion, ciclo in resultado["cambios_sesiones"].items():
            conexion.execute("UPDATE historial_sesiones SET ciclo_bono = ? WHERE id = ?", (ciclo, id_sesion))
        for cliente, ciclo in resultado["ciclo_actual_por_cliente"].items():
            conexion.execute("UPDATE clientes SET ciclo_bono = ? WHERE nombre = ?", (ciclo, cliente))

    for detalle in resultado["avisos"]:
        registrar_aviso(hoy_negocio().isoformat(), "ciclo_bono_ambiguo", detalle, ruta)

    return resultado


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    argumentos = [a for a in sys.argv[1:] if not a.startswith("--")]
    ruta = Path(argumentos[0]) if argumentos else RUTA_POR_DEFECTO
    solo_ver = "--aplicar" not in sys.argv

    resultado = calcular(ruta)
    cambios = resultado["cambios_sesiones"]

    print(f"Sesiones cuyo ciclo de bono cambia: {len(cambios)}")
    for cliente, ciclo in sorted(resultado["ciclo_actual_por_cliente"].items()):
        print(f"  {cliente}: bono actual = ciclo {ciclo}")

    if resultado["avisos"]:
        print("\nCasos a revisar (quedarán como aviso, no se adivinan):")
        for detalle in resultado["avisos"]:
            print(f"  - {detalle}")

    if solo_ver:
        print("\n(previsualización — nada guardado; vuelve a ejecutarlo con --aplicar)")
        return

    aplicar(ruta)
    print("\nCiclos de bono actualizados.")


if __name__ == "__main__":
    main()
