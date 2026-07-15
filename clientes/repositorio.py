"""Lectura y escritura de la base de datos de clientes.

Es un archivo CSV local (`datos/clientes.csv`) que Fernando edita a mano en
Excel (crear clientes, cambiar tarifa o tipo de programa) y que este módulo
lee y actualiza tras cada resumen semanal. No depende de ningún conector ni
credencial: es un archivo del propio ordenador.

Columnas: cliente, tipo_programa, tarifa, sesiones_totales, sesiones_restantes,
pendiente_pago (texto "Sí"/"No").
"""

import csv
from pathlib import Path

from programas.logica import ActualizacionPrograma

CAMPOS = ["cliente", "tipo_programa", "tarifa", "sesiones_totales", "sesiones_restantes", "pendiente_pago"]

RUTA_POR_DEFECTO = Path(__file__).resolve().parent.parent / "datos" / "clientes.csv"


def leer_clientes(ruta: Path = RUTA_POR_DEFECTO) -> dict[str, dict]:
    """Devuelve {cliente: fila} tal cual está en el CSV (todo como texto)."""
    with open(ruta, newline="", encoding="utf-8") as archivo:
        return {fila["cliente"]: fila for fila in csv.DictReader(archivo)}


def escribir_clientes(clientes: dict[str, dict], ruta: Path = RUTA_POR_DEFECTO) -> None:
    """Reescribe el CSV completo con el contenido de `clientes`."""
    with open(ruta, "w", newline="", encoding="utf-8") as archivo:
        escritor = csv.DictWriter(archivo, fieldnames=CAMPOS)
        escritor.writeheader()
        for fila in clientes.values():
            escritor.writerow(fila)


def a_programa(fila: dict) -> dict | None:
    """Convierte una fila de texto en el formato que espera `programas.procesar`.

    Devuelve None si al cliente le faltan datos por rellenar (tarifa,
    sesiones totales, etc.) — así se puede avisar a Fernando en vez de
    calcular con números inventados.
    """
    try:
        return {
            "sesiones_restantes": int(fila["sesiones_restantes"]),
            "sesiones_totales": int(fila["sesiones_totales"]),
            "pendiente_pago": fila["pendiente_pago"].strip().lower() == "sí" or fila["pendiente_pago"].strip().lower() == "si",
        }
    except (KeyError, ValueError):
        return None


def cargar_programas(ruta: Path = RUTA_POR_DEFECTO) -> tuple[dict[str, dict], list[str]]:
    """Lee el CSV y lo deja listo para `programas.procesar.procesar_semana`.

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
    """Escribe en el CSV las sesiones restantes y el pendiente de pago ya
    calculados. Solo se llama después de que Fernando confirme el resumen."""
    clientes = leer_clientes(ruta)
    for nombre, actualizacion in resultados.items():
        clientes[nombre]["sesiones_restantes"] = str(actualizacion.sesiones_restantes)
        clientes[nombre]["pendiente_pago"] = "Sí" if actualizacion.pendiente_pago else "No"
    escribir_clientes(clientes, ruta)
