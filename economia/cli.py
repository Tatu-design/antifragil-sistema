"""Consultas y registro manual sobre datos/facturacion.xlsx.

Uso:
    python -m economia.cli semana 2026-07-13     # resumen de esa semana (por su lunes)
    python -m economia.cli mes 2026 7             # resumen de ese mes
    python -m economia.cli kids 2026 7 450        # registra la facturación mensual de CrossFit Kids
                                                     y reparte el precio por sesión hacia atrás
"""

import json
import sys

from economia.registro import obtener_mes, obtener_semana, registrar_facturacion_kids


def main() -> None:
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")

    comando = sys.argv[1]

    if comando == "semana":
        resultado = obtener_semana(sys.argv[2])
    elif comando == "mes":
        resultado = obtener_mes(int(sys.argv[2]), int(sys.argv[3]))
    elif comando == "kids":
        anio, mes, facturacion = int(sys.argv[2]), int(sys.argv[3]), float(sys.argv[4])
        precio_sesion = registrar_facturacion_kids(anio, mes, facturacion)
        resultado = {"precio_por_sesion": precio_sesion, "mes_actualizado": obtener_mes(anio, mes)}
    else:
        raise ValueError(f"Comando desconocido: {comando}")

    print(json.dumps(resultado, ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    main()
