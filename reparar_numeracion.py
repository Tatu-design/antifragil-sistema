"""Corrige la numeración de sesiones y el contador de un bono (2026-08-04).

Por qué hace falta: hasta hoy, borrar una sesión del historial dejaba las
demás con su número original. Si borrabas la nº 1 de 7, quedaban numeradas
2..7 — seis sesiones, pero el contador del cliente se calculaba con el número
de la última (7). La ficha decía "7 de 8" mientras su propio historial
enseñaba 6. Lo detectó Fernando con Paquito.

El comportamiento ya está corregido en `clientes/repositorio.py`: al borrar
una sesión, las posteriores del mismo ciclo bajan un número. Este script
arregla lo que quedó descuadrado ANTES de esa corrección.

Qué hace exactamente, y solo eso:

- Renumera las sesiones de un ciclo, por orden de fecha, como 1, 2, 3...
- Pone el contador del cliente igual al número de la última.
- Si un ciclo tiene MÁS sesiones que el bono (p. ej. 9 en un bono de 8), le
  faltó una renovación: se reparte en bonos sucesivos aplicando la MISMA
  regla que usa la app al firmar. El que se llena queda cerrado con la fecha
  de su última sesión; el último queda abierto y pasa a ser el ciclo en
  curso. El cobro de los que se cierran queda **sin marcar** — nunca se
  registró y no se supone si el cliente pagó.

Qué NO toca, nunca:

- Ni una fecha, ni una tarifa, ni una hora, ni un importe.
- Ni `semanas`, ni `desglose`, ni `cargos_mensuales`.
- La facturación, las horas y el precio medio salen intactos — el número de
  sesión es una etiqueta, no entra en ningún cálculo económico.
- Los ciclos ya cerrados de un cliente que tiene ciclos posteriores: su
  numeración es historia y no se reescribe.

Uso:
    python reparar_numeracion.py [ruta_bd] [--aplicar]

Sin `--aplicar` solo muestra lo que haría.
"""

import sys
from pathlib import Path

from basedatos import RUTA_POR_DEFECTO, conectar, transaccion


def revisar(ruta: Path = RUTA_POR_DEFECTO) -> tuple[list[dict], list[str]]:
    """Devuelve (arreglos, avisos) sin escribir nada."""
    arreglos: list[dict] = []
    avisos: list[str] = []

    with conectar(ruta) as conexion:
        clientes = conexion.execute(
            "SELECT nombre, ciclo_bono, sesiones_completadas FROM clientes ORDER BY nombre"
        ).fetchall()

        for cliente in clientes:
            nombre = cliente["nombre"]
            ciclo = cliente["ciclo_bono"]

            sesiones = conexion.execute(
                "SELECT id, fecha, numero_sesion FROM historial_sesiones "
                "WHERE cliente = ? AND ciclo_bono = ? ORDER BY fecha, id",
                (nombre, ciclo),
            ).fetchall()
            if not sesiones:
                continue

            tope = conexion.execute(
                "SELECT sesiones_totales FROM programas_cliente WHERE cliente = ? AND ciclo_bono = ?",
                (nombre, ciclo),
            ).fetchone()
            tope = tope["sesiones_totales"] if tope else None

            numeros = [s["numero_sesion"] for s in sesiones]
            correcto = list(range(1, len(sesiones) + 1))
            contador_correcto = len(sesiones)

            if numeros == correcto and cliente["sesiones_completadas"] == contador_correcto:
                continue

            # Más sesiones que el bono: le faltó una renovación. Se reparte
            # aplicando la MISMA regla que usa la app al firmar (las sesiones
            # que pasan del tamaño del bono empiezan uno nuevo), no una
            # invención de este script.
            if tope and len(sesiones) > tope:
                partes = [sesiones[i:i + tope] for i in range(0, len(sesiones), tope)]
                arreglos.append({
                    "cliente": nombre,
                    "ciclo": ciclo,
                    "parte_bonos": True,
                    "tope": tope,
                    "numeros_antes": numeros,
                    "numeros_despues": [n for parte in partes for n in range(1, len(parte) + 1)],
                    "contador_antes": cliente["sesiones_completadas"],
                    "contador_despues": len(partes[-1]),
                    "ciclo_final": ciclo + len(partes) - 1,
                    # (ciclo destino, fecha de inicio, fecha de fin o None, sesiones)
                    "ciclos_nuevos": [
                        {
                            "ciclo": ciclo + i,
                            "desde": parte[0]["fecha"],
                            "hasta": None if i == len(partes) - 1 else parte[-1]["fecha"],
                            "sesiones": [(s["id"], s["numero_sesion"], n)
                                         for n, s in enumerate(parte, start=1)],
                        }
                        for i, parte in enumerate(partes)
                    ],
                })
                continue

            arreglos.append({
                "cliente": nombre,
                "ciclo": ciclo,
                "numeros_antes": numeros,
                "numeros_despues": correcto,
                "contador_antes": cliente["sesiones_completadas"],
                "contador_despues": contador_correcto,
                "tope": tope,
                "cambios": [
                    (s["id"], s["numero_sesion"], nuevo)
                    for s, nuevo in zip(sesiones, correcto)
                    if s["numero_sesion"] != nuevo
                ],
            })

    return arreglos, avisos


def aplicar(ruta: Path = RUTA_POR_DEFECTO) -> dict:
    """Escribe los arreglos. Idempotente: al segundo pase no hay nada que
    hacer, porque la numeración ya es correcta."""
    arreglos, avisos = revisar(ruta)

    with transaccion(ruta, inmediata=True) as conexion:
        for arreglo in arreglos:
            if arreglo.get("parte_bonos"):
                _repartir_en_bonos(conexion, arreglo)
            else:
                for id_sesion, _antes, despues in arreglo["cambios"]:
                    conexion.execute(
                        "UPDATE historial_sesiones SET numero_sesion = ? WHERE id = ?",
                        (despues, id_sesion),
                    )
            conexion.execute(
                "UPDATE clientes SET sesiones_completadas = ? WHERE nombre = ?",
                (arreglo["contador_despues"], arreglo["cliente"]),
            )

    return {"arreglos": arreglos, "avisos": avisos}


def _repartir_en_bonos(conexion, arreglo: dict) -> None:
    """Reparte en bonos sucesivos las sesiones de un ciclo que se pasó de
    tamaño, y deja cada uno con su ficha.

    El bono que se llena queda cerrado con la fecha de su última sesión. El
    último queda abierto, y es el que pasa a ser el ciclo en curso del
    cliente.

    El estado de cobro de los bonos que se cierran queda **sin marcar**, no
    en "pagado" ni en "pendiente": nunca se registró y no se va a suponer si
    el cliente pagó o no. Fernando lo marca desde el historial cuando lo
    sepa. El bono en curso conserva el estado de cobro que ya tenía el
    cliente."""
    cliente = arreglo["cliente"]
    plantilla = conexion.execute(
        "SELECT tipo_programa, modalidad, tarifa, sesiones_totales, precio_total, "
        "       cuota_mensual, sesiones_referencia, anio, mes, pagado "
        "FROM programas_cliente WHERE cliente = ? AND ciclo_bono = ?",
        (cliente, arreglo["ciclo"]),
    ).fetchone()

    for parte in arreglo["ciclos_nuevos"]:
        for id_sesion, _antes, nuevo in parte["sesiones"]:
            conexion.execute(
                "UPDATE historial_sesiones SET ciclo_bono = ?, numero_sesion = ? WHERE id = ?",
                (parte["ciclo"], nuevo, id_sesion),
            )

        if plantilla is None:
            continue

        es_el_ultimo = parte["hasta"] is None
        conexion.execute(
            "INSERT INTO programas_cliente "
            "(cliente, ciclo_bono, tipo_programa, modalidad, tarifa, sesiones_totales, precio_total, "
            " cuota_mensual, sesiones_referencia, anio, mes, fecha_inicio, fecha_fin, pagado) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(cliente, ciclo_bono) DO UPDATE SET "
            "  fecha_inicio = excluded.fecha_inicio, fecha_fin = excluded.fecha_fin",
            (
                cliente, parte["ciclo"], plantilla["tipo_programa"], plantilla["modalidad"],
                plantilla["tarifa"], plantilla["sesiones_totales"], plantilla["precio_total"],
                plantilla["cuota_mensual"], plantilla["sesiones_referencia"],
                plantilla["anio"], plantilla["mes"], parte["desde"], parte["hasta"],
                # Los cerrados quedan sin marcar; el que sigue abierto conserva
                # el estado de cobro que el cliente ya tenía.
                plantilla["pagado"] if es_el_ultimo else None,
            ),
        )

    conexion.execute(
        "UPDATE clientes SET ciclo_bono = ? WHERE nombre = ?",
        (arreglo["ciclo_final"], cliente),
    )


def reparar_si_hace_falta(ruta: Path = RUTA_POR_DEFECTO) -> int:
    """Repaso al arrancar la web, como el resto de reparaciones. Devuelve
    cuántos clientes se han corregido (0 si no había nada)."""
    if not ruta.exists():
        return 0
    arreglos, _ = revisar(ruta)
    if not arreglos:
        return 0
    return len(aplicar(ruta)["arreglos"])


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    argumentos = [a for a in sys.argv[1:] if not a.startswith("--")]
    ruta = Path(argumentos[0]) if argumentos else RUTA_POR_DEFECTO
    solo_ver = "--aplicar" not in sys.argv

    arreglos, avisos = revisar(ruta)

    if not arreglos:
        print("No hay ninguna numeración que corregir.")
    else:
        print(f"Clientes a corregir: {len(arreglos)}\n")
        for a in arreglos:
            print(f"  {a['cliente']} (bono de {a['tope']})")
            print(f"      números  : {a['numeros_antes']}  ->  {a['numeros_despues']}")
            print(f"      contador : {a['contador_antes']}  ->  {a['contador_despues']}")
            if a.get("parte_bonos"):
                print(f"      se reparte en {len(a['ciclos_nuevos'])} bonos "
                      f"(le faltaba una renovación):")
                for parte in a["ciclos_nuevos"]:
                    estado = "en curso" if parte["hasta"] is None else f"cerrado el {parte['hasta']}"
                    print(f"        bono {parte['ciclo']}: {len(parte['sesiones'])} sesiones "
                          f"desde {parte['desde']} · {estado}")
            else:
                print(f"      sesiones que cambian de número: {len(a['cambios'])}")

    if avisos:
        print("\nA decidir con Fernando (NO se tocan):")
        for aviso in avisos:
            print(f"  - {aviso}")

    print("\nNi la facturación, ni las horas, ni el precio medio cambian: el número")
    print("de sesión es una etiqueta y no entra en ningún cálculo económico.")

    if solo_ver:
        print("\n(previsualización — nada guardado; vuelve a ejecutarlo con --aplicar)")
        return

    aplicar(ruta)
    print("\nHecho.")


if __name__ == "__main__":
    main()
