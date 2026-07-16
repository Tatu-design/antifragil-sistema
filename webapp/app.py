"""Proyecto de aprendizaje: una web app real con Flask.

Concepto clave de Flask: defines "rutas" (una URL) y una función Python que
se ejecuta cuando alguien visita esa URL. Esa función devuelve el HTML que
se muestra en el navegador — normalmente generado a partir de una
"plantilla" (un archivo .html con huecos que Flask rellena con datos reales).

Milestone 1: mostrar los clientes (solo lectura).
Milestone 2 (este): poder editar sesiones llevadas y pendiente de pago desde
la web. Sigue la misma regla de seguridad que el resto del proyecto: nunca
se guarda nada directamente desde el formulario de edición — antes se
muestra una pantalla de "vas a cambiar esto" y solo al confirmar se escribe
en datos/clientes.xlsx.
"""

from flask import Flask, redirect, render_template, request, url_for

from clientes.repositorio import actualizar_cliente, leer_clientes

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
    guardado = request.args.get("guardado")
    return render_template("index.html", clientes=_con_sesiones_restantes(clientes), guardado=guardado)


@app.route("/cliente/<nombre>/editar")
def editar(nombre):
    clientes = leer_clientes()
    if nombre not in clientes:
        return f"No existe el cliente '{nombre}'", 404
    cliente = clientes[nombre]
    pendiente_pago = str(cliente.get("pendiente_pago", "")).strip().lower() in ("sí", "si")
    return render_template("editar.html", nombre=nombre, cliente=cliente, pendiente_pago=pendiente_pago)


@app.route("/cliente/<nombre>/confirmar", methods=["POST"])
def confirmar(nombre):
    clientes = leer_clientes()
    if nombre not in clientes:
        return f"No existe el cliente '{nombre}'", 404

    actual = clientes[nombre]
    nuevas_sesiones_llevadas = int(request.form["sesiones_llevadas"])
    nuevo_pendiente_pago = "pendiente_pago" in request.form  # una casilla marcada sí aparece en el formulario

    return render_template(
        "confirmar.html",
        nombre=nombre,
        antes={
            "sesiones_llevadas": actual.get("sesiones_llevadas"),
            "pendiente_pago": str(actual.get("pendiente_pago", "")).strip().lower() in ("sí", "si"),
        },
        despues={
            "sesiones_llevadas": nuevas_sesiones_llevadas,
            "pendiente_pago": nuevo_pendiente_pago,
        },
    )


@app.route("/cliente/<nombre>/guardar", methods=["POST"])
def guardar(nombre):
    sesiones_llevadas = int(request.form["sesiones_llevadas"])
    pendiente_pago = request.form["pendiente_pago"] == "si"
    actualizar_cliente(nombre, sesiones_llevadas, pendiente_pago)
    return redirect(url_for("inicio", guardado=nombre))


if __name__ == "__main__":
    app.run(debug=True)
