"""Lectura y escritura de la base de datos de clientes.

Es un archivo Excel local (`datos/clientes.xlsx`, con formato — ver
`clientes/generar_plantilla.py`) que Fernando edita a mano (crear clientes,
cambiar tarifa o tipo de programa) y que este módulo lee y actualiza tras
cada resumen semanal. No depende de ningún conector ni credencial: es un
archivo del propio ordenador. Al escribir solo se cambian valores de celda,
nunca el formato, así que el aspecto del Excel no se pierde.
"""

from pathlib import Path

from openpyxl import load_workbook

from programas.logica import ActualizacionPrograma

RUTA_POR_DEFECTO = Path(__file__).resolve().parent.parent / "datos" / "clientes.xlsx"
HOJA = "Clientes"
PRIMERA_FILA_DATOS = 3


def leer_clientes(ruta: Path = RUTA_POR_DEFECTO) -> dict[str, dict]:
    """Devuelve {cliente: {fila, tipo_programa, tarifa, sesiones_totales,
    sesiones_restantes, pendiente_pago}} tal cual está en el Excel."""
    wb = load_workbook(ruta, data_only=True)
    hoja = wb[HOJA]

    clientes: dict[str, dict] = {}
    fila = PRIMERA_FILA_DATOS
    while hoja[f"A{fila}"].value:
        clientes[hoja[f"A{fila}"].value] = {
            "fila": fila,
            "tipo_programa": hoja[f"B{fila}"].value,
            "tarifa": hoja[f"C{fila}"].value,
            "sesiones_totales": hoja[f"D{fila}"].value,
            "sesiones_restantes": hoja[f"E{fila}"].value,
            "pendiente_pago": hoja[f"F{fila}"].value,
        }
        fila += 1

    return clientes


def a_programa(fila: dict) -> dict | None:
    """Convierte una fila en el formato que espera `programas.procesar`.

    Devuelve None si al cliente le faltan datos por rellenar (tarifa,
    sesiones totales, etc.) — así se puede avisar a Fernando en vez de
    calcular con números inventados.
    """
    try:
        return {
            "sesiones_restantes": int(fila["sesiones_restantes"]),
            "sesiones_totales": int(fila["sesiones_totales"]),
            "pendiente_pago": str(fila["pendiente_pago"]).strip().lower() in ("sí", "si"),
        }
    except (TypeError, ValueError):
        return None


def cargar_programas(ruta: Path = RUTA_POR_DEFECTO) -> tuple[dict[str, dict], list[str]]:
    """Lee el Excel y lo deja listo para `programas.procesar.procesar_semana`.

    Devuelve (programas, incompletos): los clientes sin tarifa/sesiones
    rellenas todavía se listan aparte en vez de calcular con datos inventados.
    """
    clientes = leer_clientes(ruta)
    programas: dict[str, dict] = {}
    incompletos: list[str] = []

    for nombre, fila in clientes.items():
        programa = a_programa(fila)
        if programa is None:
            incompletos.append(nombre)
        else:
            programas[nombre] = programa

    return programas, incompletos


def aplicar_actualizaciones(
    resultados: dict[str, ActualizacionPrograma], ruta: Path = RUTA_POR_DEFECTO
) -> None:
    """Escribe en el Excel las sesiones restantes y el pendiente de pago ya
    calculados. Solo se llama después de que Fernando confirme el resumen.
    Solo se tocan valores de celda: el formato del Excel no cambia."""
    clientes = leer_clientes(ruta)
    wb = load_workbook(ruta)
    hoja = wb[HOJA]

    for nombre, actualizacion in resultados.items():
        fila = clientes[nombre]["fila"]
        hoja[f"E{fila}"] = actualizacion.sesiones_restantes
        hoja[f"F{fila}"] = "Sí" if actualizacion.pendiente_pago else "No"

    wb.save(ruta)
