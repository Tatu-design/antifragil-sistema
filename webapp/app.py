"""Primer paso del proyecto de aprendizaje: una web app real con Flask.

Concepto clave de Flask: defines "rutas" (una URL) y una función Python que
se ejecuta cuando alguien visita esa URL. Esa función devuelve el HTML que
se muestra en el navegador — normalmente generado a partir de una
"plantilla" (un archivo .html con huecos que Flask rellena con datos reales).

De momento es de solo lectura: lee datos/clientes.xlsx con el mismo código
que ya usa el resto del proyecto (clientes/repositorio.py) y lo muestra.
Nada se escribe todavía — eso es el paso 2.
"""

from flask import Flask, render_template

from clientes.repositorio import leer_clientes

app = Flask(__name__)


def _con_sesiones_restantes(clientes: dict) -> list[dict]:
    """Prepara los datos de cada cliente para la plantilla: añade las
    sesiones restantes y un pequeño estado (pendiente de pago o no)."""
    filas = []
    for nombre, datos in clientes.items():
        totales = datos.get("sesiones_totales")
        llevadas = datos.get("sesiones_llevadas")
        restantes = None
        if isinstance(totales, (int, float)) and isinstance(llevadas, (int, float)):
            restantes = int(totales) - int(llevadas)

        filas.append(
            {
                "nombre": nombre,
                "tipo_programa": datos.get("tipo_programa"),
                "tarifa": datos.get("tarifa"),
                "sesiones_totales": totales,
                "sesiones_llevadas": llevadas,
                "sesiones_restantes": restantes,
                "pendiente_pago": str(datos.get("pendiente_pago", "")).strip().lower() in ("sí", "si"),
            }
        )
    return filas


@app.route("/")
def inicio():
    clientes = leer_clientes()
    return render_template("index.html", clientes=_con_sesiones_restantes(clientes))


if __name__ == "__main__":
    app.run(debug=True)
