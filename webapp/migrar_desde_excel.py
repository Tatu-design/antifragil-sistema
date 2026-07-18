"""Migra los datos de datos/clientes.xlsx a datos/webapp.db (SQLite).

Se ejecuta una vez para arrancar la base de datos con los datos reales
actuales. Si se vuelve a ejecutar, actualiza los programas y añade los
clientes que falten, pero no borra nada — así es seguro repetirlo.

Uso: python -m webapp.migrar_desde_excel
"""

from openpyxl import load_workbook

from clientes.repositorio import HOJA_PROGRAMAS, RUTA_POR_DEFECTO as RUTA_EXCEL, leer_clientes
from webapp.db import crear_cliente, crear_esquema, guardar_programa, leer_clientes as leer_clientes_db


def _leer_programas_excel() -> list[tuple[str, float, int]]:
    wb = load_workbook(RUTA_EXCEL, data_only=True)
    hoja = wb[HOJA_PROGRAMAS]
    programas = []
    fila = 3
    while hoja[f"A{fila}"].value:
        programas.append((hoja[f"A{fila}"].value, hoja[f"B{fila}"].value, hoja[f"C{fila}"].value))
        fila += 1
    return programas


def migrar() -> None:
    crear_esquema()

    programas = _leer_programas_excel()
    for nombre, tarifa, sesiones_totales in programas:
        guardar_programa(nombre, tarifa, sesiones_totales)
    print(f"Programas migrados: {len(programas)}")

    clientes_excel = leer_clientes(RUTA_EXCEL)
    clientes_ya_en_db = leer_clientes_db()

    nuevos = 0
    for nombre, datos in clientes_excel.items():
        if nombre in clientes_ya_en_db:
            continue
        if datos.get("tipo_programa") is None:
            print(f"  Aviso: '{nombre}' no tiene programa asignado en el Excel, se omite.")
            continue
        crear_cliente(
            nombre=nombre,
            tipo_programa=datos["tipo_programa"],
            sesiones_completadas=int(datos.get("sesiones_completadas") or 0),
            pendiente_pago=str(datos.get("pendiente_pago", "")).strip().lower() in ("sí", "si"),
        )
        nuevos += 1
    print(f"Clientes nuevos migrados: {nuevos}")


if __name__ == "__main__":
    migrar()
