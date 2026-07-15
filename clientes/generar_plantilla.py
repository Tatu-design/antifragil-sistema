"""Genera datos/clientes.xlsx: un Excel con formato para que Fernando rellene
los datos de sus clientes a mano. Se ejecuta una sola vez (o cuando se quiera
regenerar la plantilla desde cero); las ediciones normales de Fernando se
hacen abriendo el archivo directamente en Excel.

Uso: python -m clientes.generar_plantilla
"""

from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

RUTA_SALIDA = Path(__file__).resolve().parent.parent / "datos" / "clientes.xlsx"

CLIENTES_INICIALES = [
    "Nikki", "Felipe y Javi", "Rocío", "Samanta", "Neha", "Paquito", "Ana", "Sunil",
]

COLUMNAS = [
    ("Cliente", 26),
    ("Tipo de programa", 22),
    ("Tarifa (€)", 14),
    ("Sesiones totales", 16),
    ("Sesiones restantes", 18),
    ("Pendiente de pago", 18),
]

AZUL_ANTIFRAGIL = "1F3B4D"
GRIS_CLARO = "F2F2F2"
VERDE_SUAVE = "C6EFCE"
VERDE_TEXTO = "006100"
ROJO_SUAVE = "FFC7CE"
ROJO_TEXTO = "9C0006"

BORDE_FINO = Border(*(Side(style="thin", color="D9D9D9") for _ in range(4)))


def construir_workbook() -> Workbook:
    wb = Workbook()
    hoja = wb.active
    hoja.title = "Clientes"

    # Título
    hoja.merge_cells("A1:F1")
    titulo = hoja["A1"]
    titulo.value = "Antifrágil — Clientes de Entrenamiento Personal"
    titulo.font = Font(size=14, bold=True, color="FFFFFF")
    titulo.fill = PatternFill("solid", fgColor=AZUL_ANTIFRAGIL)
    titulo.alignment = Alignment(horizontal="center", vertical="center")
    hoja.row_dimensions[1].height = 28

    # Cabecera
    fila_cabecera = 2
    for col_idx, (nombre, ancho) in enumerate(COLUMNAS, start=1):
        letra = get_column_letter(col_idx)
        celda = hoja[f"{letra}{fila_cabecera}"]
        celda.value = nombre
        celda.font = Font(bold=True, color="FFFFFF")
        celda.fill = PatternFill("solid", fgColor=AZUL_ANTIFRAGIL)
        celda.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        celda.border = BORDE_FINO
        hoja.column_dimensions[letra].width = ancho
    hoja.row_dimensions[fila_cabecera].height = 24

    # Filas de datos (clientes ya detectados, resto en blanco para rellenar)
    primera_fila_datos = fila_cabecera + 1
    for i, cliente in enumerate(CLIENTES_INICIALES):
        fila = primera_fila_datos + i
        hoja[f"A{fila}"] = cliente

        for col_idx in range(1, len(COLUMNAS) + 1):
            letra = get_column_letter(col_idx)
            celda = hoja[f"{letra}{fila}"]
            celda.border = BORDE_FINO
            if i % 2 == 1:
                celda.fill = PatternFill("solid", fgColor=GRIS_CLARO)

        hoja[f"C{fila}"].number_format = "#,##0.00 €"
        hoja[f"D{fila}"].number_format = "0"
        hoja[f"E{fila}"].number_format = "0"
        hoja[f"F{fila}"] = "No"
        for letra in ("A", "B", "C", "D", "E", "F"):
            hoja[f"{letra}{fila}"].alignment = Alignment(horizontal="center", vertical="center")
        hoja[f"A{fila}"].alignment = Alignment(horizontal="left", vertical="center")

    ultima_fila = primera_fila_datos + len(CLIENTES_INICIALES) - 1

    # Desplegable Sí/No para "Pendiente de pago"
    validacion = DataValidation(type="list", formula1='"Sí,No"', allow_blank=False)
    hoja.add_data_validation(validacion)
    validacion.add(f"F{primera_fila_datos}:F{ultima_fila + 20}")

    # Resaltado de pendientes de pago
    from openpyxl.formatting.rule import CellIsRule

    hoja.conditional_formatting.add(
        f"F{primera_fila_datos}:F{ultima_fila + 20}",
        CellIsRule(operator="equal", formula=['"Sí"'], fill=PatternFill("solid", fgColor=ROJO_SUAVE),
                   font=Font(color=ROJO_TEXTO)),
    )
    hoja.conditional_formatting.add(
        f"F{primera_fila_datos}:F{ultima_fila + 20}",
        CellIsRule(operator="equal", formula=['"No"'], fill=PatternFill("solid", fgColor=VERDE_SUAVE),
                   font=Font(color=VERDE_TEXTO)),
    )

    hoja.freeze_panes = f"A{primera_fila_datos}"
    hoja.auto_filter.ref = f"A{fila_cabecera}:F{ultima_fila}"

    return wb


def main() -> None:
    wb = construir_workbook()
    wb.save(RUTA_SALIDA)
    print(f"Plantilla creada en {RUTA_SALIDA}")


if __name__ == "__main__":
    main()
