"""Proyecto de aprendizaje: una web app real con Flask.

Concepto clave de Flask: defines "rutas" (una URL) y una función Python que
se ejecuta cuando alguien visita esa URL. Esa función devuelve el HTML que
se muestra en el navegador — normalmente generado a partir de una
"plantilla" (un archivo .html con huecos que Flask rellena con datos reales).

Milestone 1: mostrar los clientes (solo lectura).
Milestone 2: crear clientes nuevos y editar nombre, tipo de programa,
sesiones completadas y pendiente de pago desde la web. Sigue la misma regla
de seguridad que el resto del proyecto: nunca se guarda nada directamente
desde un formulario — antes se muestra una pantalla de "vas a guardar esto"
y solo al confirmar se escribe en la base de datos.

Desde el 2026-07-18, `clientes/repositorio.py` y `economia/registro.py`
(de donde vienen todas las funciones de aquí abajo) usan SQLite
(`datos/antifragil.db`) en vez de Excel — es el sistema real del negocio,
no solo esta web de aprendizaje.
"""

import sqlite3
from datetime import datetime

from flask import Flask, redirect, render_template, request, url_for

from calendar_integration.semana import get_week_range
from clientes.repositorio import actualizar_cliente, crear_cliente, leer_clientes, listar_tipos_programa
from economia.registro import obtener_mes, obtener_semana

app = Flask(__name__)


def _con_sesiones_restantes(clientes: dict) -> list[dict]:
    """Prepara los datos de cada cliente para la plantilla: añade las
    sesiones restantes y un pequeño estado (pendiente de pago o no)."""
    filas = []
    for nombre, datos in clientes.items():
        totales = datos.get("sesiones_totales")
        completadas = datos.get("sesiones_completadas")
        restantes = None
        if isinstance(totales, (int, float)) and isinstance(completadas, (int, float)):
            restantes = int(totales) - int(completadas)

        filas.append(
            {
                "nombre": nombre,
                "tipo_programa": datos.get("tipo_programa"),
                "tarifa": datos.get("tarifa"),
                "sesiones_totales": totales,
                "sesiones_completadas": completadas,
                "sesiones_restantes": restantes,
                "pendiente_pago": str(datos.get("pendiente_pago", "")).strip().lower() in ("sí", "si"),
            }
        )
    return filas


def _es_si(valor) -> bool:
    return str(valor or "").strip().lower() in ("sí", "si")


@app.route("/")
def inicio():
    clientes = leer_clientes()
    guardado = request.args.get("guardado")
    return render_template("index.html", clientes=_con_sesiones_restantes(clientes), guardado=guardado)


@app.route("/cliente/nuevo")
def nuevo():
    return render_template("nuevo.html", tipos_programa=listar_tipos_programa())


@app.route("/cliente/nuevo/confirmar", methods=["POST"])
def confirmar_nuevo():
    nombre = request.form["nombre"].strip()
    tipo_programa = request.form["tipo_programa"]
    sesiones_completadas = int(request.form["sesiones_completadas"])
    pendiente_pago = "pendiente_pago" in request.form

    if not nombre:
        return render_template("nuevo.html", tipos_programa=listar_tipos_programa(), error="Falta el nombre del cliente"), 400
    if nombre in leer_clientes():
        return render_template("nuevo.html", tipos_programa=listar_tipos_programa(), error=f"Ya existe un cliente llamado '{nombre}'"), 400

    return render_template(
        "confirmar_nuevo.html",
        nombre=nombre,
        tipo_programa=tipo_programa,
        sesiones_completadas=sesiones_completadas,
        pendiente_pago=pendiente_pago,
    )


@app.route("/cliente/nuevo/guardar", methods=["POST"])
def guardar_nuevo():
    try:
        crear_cliente(
            nombre=request.form["nombre"],
            tipo_programa=request.form["tipo_programa"],
            sesiones_completadas=int(request.form["sesiones_completadas"]),
            pendiente_pago=request.form["pendiente_pago"] == "si",
        )
    except sqlite3.OperationalError:
        return render_template(
            "error.html",
            mensaje="No se pudo guardar: la base de datos está ocupada ahora mismo. Vuelve a intentarlo en unos segundos.",
        ), 409
    except ValueError as error:
        return render_template("error.html", mensaje=str(error)), 400

    return redirect(url_for("inicio", guardado=request.form["nombre"]))


@app.route("/cliente/<nombre>/editar")
def editar(nombre):
    clientes = leer_clientes()
    if nombre not in clientes:
        return f"No existe el cliente '{nombre}'", 404
    cliente = clientes[nombre]
    return render_template(
        "editar.html",
        nombre=nombre,
        cliente=cliente,
        pendiente_pago=_es_si(cliente.get("pendiente_pago")),
        tipos_programa=listar_tipos_programa(),
    )


@app.route("/cliente/<nombre>/confirmar", methods=["POST"])
def confirmar(nombre):
    clientes = leer_clientes()
    if nombre not in clientes:
        return f"No existe el cliente '{nombre}'", 404

    actual = clientes[nombre]
    nuevo_nombre = request.form["nombre"].strip()
    nuevo_tipo_programa = request.form["tipo_programa"]
    nuevas_sesiones_completadas = int(request.form["sesiones_completadas"])
    nuevo_pendiente_pago = "pendiente_pago" in request.form  # una casilla marcada sí aparece en el formulario

    return render_template(
        "confirmar.html",
        nombre=nombre,
        antes={
            "nombre": nombre,
            "tipo_programa": actual.get("tipo_programa"),
            "sesiones_completadas": actual.get("sesiones_completadas"),
            "pendiente_pago": _es_si(actual.get("pendiente_pago")),
        },
        despues={
            "nombre": nuevo_nombre,
            "tipo_programa": nuevo_tipo_programa,
            "sesiones_completadas": nuevas_sesiones_completadas,
            "pendiente_pago": nuevo_pendiente_pago,
        },
    )


@app.route("/cliente/<nombre>/guardar", methods=["POST"])
def guardar(nombre):
    try:
        actualizar_cliente(
            nombre=nombre,
            nuevo_nombre=request.form["nombre"],
            tipo_programa=request.form["tipo_programa"],
            sesiones_completadas=int(request.form["sesiones_completadas"]),
            pendiente_pago=request.form["pendiente_pago"] == "si",
        )
    except sqlite3.OperationalError:
        return render_template(
            "error.html",
            mensaje="No se pudo guardar: la base de datos está ocupada ahora mismo. Vuelve a intentarlo en unos segundos.",
        ), 409
    except ValueError as error:
        return render_template("error.html", mensaje=str(error)), 400

    return redirect(url_for("inicio", guardado=request.form["nombre"]))


@app.route("/economia")
def economia():
    lunes_semana_actual, _ = get_week_range(datetime.now())
    fecha = lunes_semana_actual.date()

    semana = obtener_semana(fecha.isoformat())
    mes = obtener_mes(fecha.year, fecha.month)

    return render_template("economia.html", semana=semana, mes=mes, fecha_semana=fecha)


if __name__ == "__main__":
    # debug=False a propósito: esta app va a quedar arrancada de forma
    # permanente (arranque automático), y el modo de depuración de Flask
    # deja accesible una consola que podría ejecutar código arbitrario si
    # algún día la app fuera visible desde la red — ver
    # docs/APRENDIZAJE_WEBAPP.md.
    app.run(debug=False)
