"""Migra los datos reales de datos/clientes.xlsx a datos/antifragil.db (SQLite).

Se ejecuta una vez para arrancar el sistema real con los datos actuales.
Es seguro volver a ejecutarlo: actualiza los programas y añade los clientes
que falten, pero no borra nada.

Uso: python -m migrar_excel_a_sqlite
"""

from pathlib import Path

from openpyxl import load_workbook

from basedatos import crear_esquema
from clientes.repositorio import crear_cliente, guardar_programa, leer_clientes

RUTA_EXCEL = Path(__file__).resolve().parent / "datos" / "clientes.xlsx"
HOJA_CLIENTES = "Clientes"
HOJA_PROGRAMAS = "Programas"
PRIMERA_FILA_DATOS = 3


def _leer_excel_crudo() -> tuple[list[tuple], dict[str, dict]]:
    wb = load_workbook(RUTA_EXCEL, data_only=True)

    hoja_programas = wb[HOJA_PROGRAMAS]
    programas = []
    fila = 3
    while hoja_programas[f"A{fila}"].value:
        programas.append((hoja_programas[f"A{fila}"].value, hoja_programas[f"B{fila}"].value, hoja_programas[f"C{fila}"].value))
        fila += 1

    # Diccionario nombre_programa -> (tarifa, sesiones) para rellenar huecos
    # si la fórmula de la hoja "Clientes" no tenía valor cacheado.
    tabla_programas = {nombre: (tarifa, sesiones) for nombre, tarifa, sesiones in programas}

    hoja_clientes = wb[HOJA_CLIENTES]
    clientes = {}
    fila = PRIMERA_FILA_DATOS
    while hoja_clientes[f"A{fila}"].value:
        nombre = hoja_clientes[f"A{fila}"].value
        tipo_programa = hoja_clientes[f"B{fila}"].value
        clientes[nombre] = {
            "tipo_programa": tipo_programa,
            "sesiones_completadas": hoja_clientes[f"E{fila}"].value,
            "pendiente_pago": hoja_clientes[f"F{fila}"].value,
        }
        fila += 1

    return programas, clientes


def migrar() -> None:
    crear_esquema()

    programas, clientes_excel = _leer_excel_crudo()
    for nombre, tarifa, sesiones_totales in programas:
        guardar_programa(nombre, tarifa, sesiones_totales)
    print(f"Programas migrados: {len(programas)}")

    clientes_ya_en_db = leer_clientes()

    nuevos = 0
    omitidos = 0
    for nombre, datos in clientes_excel.items():
        if nombre in clientes_ya_en_db:
            continue
        if datos.get("tipo_programa") is None:
            print(f"  Aviso: '{nombre}' no tiene programa asignado en el Excel, se omite.")
            omitidos += 1
            continue
        crear_cliente(
            nombre=nombre,
            tipo_programa=datos["tipo_programa"],
            sesiones_completadas=int(datos.get("sesiones_completadas") or 0),
            pendiente_pago=str(datos.get("pendiente_pago", "")).strip().lower() in ("sí", "si"),
        )
        nuevos += 1
    print(f"Clientes nuevos migrados: {nuevos} (omitidos por datos incompletos: {omitidos})")


if __name__ == "__main__":
    migrar()
