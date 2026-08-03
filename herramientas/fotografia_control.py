"""Fotografía de control: TODO lo que Fernando ve en pantalla, en un solo
diccionario comparable (2026-08-03).

Sirve para demostrar con números que un cambio no ha movido nada. Se saca
una foto antes de tocar, otra después, y se comparan. Si sale una sola
diferencia, el trabajo no se entrega.

No escribe nada nunca — solo lee.
"""

import sys
from pathlib import Path

# Vive en herramientas/, pero los módulos del proyecto están un nivel arriba.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import basedatos
import clientes.repositorio as cr
import economia.registro as er


def sacar(ruta: Path) -> dict:
    """Facturación, horas, precio medio, sesiones, ciclos y deudas."""
    foto: dict = {"meses": [], "clientes": {}, "totales": {}}

    for resumen in er.listar_meses(ruta):
        mes = er.obtener_mes(resumen["anio"], resumen["mes"], ruta)
        foto["meses"].append({
            "cuando": f"{resumen['anio']}-{resumen['mes']:02d}",
            "facturacion": round(mes["facturacion_total"], 2),
            "horas": mes["horas_totales"],
            "precio_medio": round(mes["precio_medio_hora"], 4),
            "kids": mes["sesiones_kids"],
            "provisional": mes["provisional"],
            "ajuste": round(mes["ajuste_importe"], 2),
        })

    for nombre, datos in cr.leer_clientes(ruta).items():
        sesiones = cr.obtener_historial(nombre, ruta=ruta)
        foto["clientes"][nombre] = {
            "programa": datos["tipo_programa"],
            "tarifa": datos["tarifa"],
            "sesiones_totales": datos["sesiones_totales"],
            "completadas": datos["sesiones_completadas"],
            "debe": datos["pendiente_pago"],
            "estado": datos["estado"],
            "n_sesiones": len(sesiones),
            # Las sesiones se comparan una a una: fecha, número y tarifa.
            # Así un cambio en una sola fila salta, no solo en el total.
            "sesiones": [(s["fecha"], s["numero_sesion"], s["tarifa"], s["ciclo_bono"]) for s in sesiones],
            "ciclos": [
                (b["ciclo_bono"], b["tipo_programa"], b["tarifa"], b["fecha_inicio"], b["fecha_fin"], b["pagado"])
                for b in cr.obtener_programas_cliente(nombre, ruta=ruta)
            ],
        }

    with basedatos.conectar(ruta) as conexion:
        for tabla in ("clientes", "historial_sesiones", "programas_cliente", "clases_grupo",
                      "semanas", "desglose", "ajustes_mensuales", "firmas_publicas"):
            foto["totales"][tabla] = conexion.execute(f"SELECT COUNT(*) AS n FROM {tabla}").fetchone()["n"]
        foto["totales"]["integridad"] = conexion.execute("PRAGMA integrity_check").fetchone()[0]
        foto["totales"]["claves_rotas"] = len(conexion.execute("PRAGMA foreign_key_check").fetchall())

    return foto


def comparar(antes: dict, despues: dict) -> list[str]:
    """Devuelve las diferencias en lenguaje llano. Lista vacía = idéntico."""
    diferencias: list[str] = []

    if antes["totales"] != despues["totales"]:
        for clave in sorted(set(antes["totales"]) | set(despues["totales"])):
            if antes["totales"].get(clave) != despues["totales"].get(clave):
                diferencias.append(
                    f"{clave}: {antes['totales'].get(clave)} → {despues['totales'].get(clave)}"
                )

    meses_antes = {m["cuando"]: m for m in antes["meses"]}
    meses_despues = {m["cuando"]: m for m in despues["meses"]}
    for cuando in sorted(set(meses_antes) | set(meses_despues)):
        if meses_antes.get(cuando) != meses_despues.get(cuando):
            diferencias.append(f"mes {cuando}: {meses_antes.get(cuando)} → {meses_despues.get(cuando)}")

    for nombre in sorted(set(antes["clientes"]) | set(despues["clientes"])):
        uno, otro = antes["clientes"].get(nombre), despues["clientes"].get(nombre)
        if uno != otro:
            if uno is None or otro is None:
                diferencias.append(f"cliente '{nombre}': {'aparece' if uno is None else 'desaparece'}")
                continue
            for clave in sorted(set(uno) | set(otro)):
                if uno.get(clave) != otro.get(clave):
                    diferencias.append(f"cliente '{nombre}', {clave}: {uno.get(clave)} → {otro.get(clave)}")

    return diferencias


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ruta = Path(sys.argv[1]) if len(sys.argv) > 1 else basedatos.RUTA_POR_DEFECTO
    foto = sacar(ruta)

    print(f"Meses con datos: {len(foto['meses'])}")
    for mes in foto["meses"]:
        print(f"  {mes['cuando']}  {mes['facturacion']:>9.2f} €  {mes['horas']:>3} h  "
              f"media {mes['precio_medio']:.2f} €/h")
    print(f"\nClientes: {len(foto['clientes'])}")
    for nombre, datos in foto["clientes"].items():
        print(f"  {nombre:<18} {datos['n_sesiones']:>2} sesiones · {len(datos['ciclos'])} ciclos · "
              f"{'debe' if datos['debe'] == 'Sí' else 'al día'} · {datos['estado']}")
    print("\nFilas por tabla:")
    for tabla, n in foto["totales"].items():
        print(f"  {tabla:<22} {n}")


if __name__ == "__main__":
    main()
