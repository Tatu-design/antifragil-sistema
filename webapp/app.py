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
import tempfile
import uuid
from datetime import datetime
from pathlib import Path

from zona_horaria import hoy_negocio

from flask import Flask, after_this_request, jsonify, redirect, render_template, request, send_file, session, url_for

from avisos import contar_no_leidos, listar_avisos_pendientes, marcar_todos_leidos, registrar_aviso, resolver_aviso
from basedatos import RUTA_POR_DEFECTO, crear_esquema
from clientes.repositorio import (
    actualizar_cliente,
    asegurar_tokens,
    crear_cliente,
    leer_clientes,
    listar_tipos_programa,
    obtener_cliente_por_token,
    obtener_historial,
)
from economia.registro import listar_meses, obtener_mes, obtener_ultima_semana
from firma_publica import firma_de_hoy, firmar_sesion_publica
from procesar_dia import procesar_dia
from registrar_asistencia import (
    editar_sesion_pt,
    eliminar_sesion_pt,
    eliminar_ultima_clase_grupo,
    registrar_clase_grupo,
    registrar_sesion_pt,
)
from verificar_semana import verificar_semana
from webapp.auth import establecer_password, hay_password_configurada, obtener_admin_token, obtener_secret_key, verificar_password

crear_esquema()  # crea las tablas si es la primera vez que arranca en esta máquina (ej. un servidor nuevo)
asegurar_tokens()  # da un enlace personal a clientes dados de alta antes del milestone 4

app = Flask(__name__)
app.secret_key = obtener_secret_key()
# El CSS, el logo y la tipografía casi nunca cambian — sin esto, el
# navegador los volvía a descargar en cada página (iba notablemente más
# lenta). Una semana de caché es un buen equilibrio para un proyecto que
# cambia de vez en cuando, no cada día.
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 60 * 60 * 24 * 7

# admin_procesar_dia no usa contraseña de sesión (lo llama una rutina
# automática, no un navegador) — se protege con su propio token, comprobado
# dentro de la propia función.
RUTAS_PUBLICAS = {
    "login", "configurar_password", "static", "admin_procesar_dia", "admin_debug",
    "admin_verificar_semana", "admin_backup", "mi_perfil", "mi_firmar",
}


@app.before_request
def _requerir_login():
    """Se ejecuta antes de cada petición. Antes de que esta web sea visible
    desde internet, hace falta al menos una contraseña — si no, cualquiera
    con el enlace podría ver y editar los datos de los clientes."""
    if request.endpoint in RUTAS_PUBLICAS:
        return None

    if not hay_password_configurada():
        return redirect(url_for("configurar_password"))

    if not session.get("autenticado"):
        return redirect(url_for("login"))

    return None


@app.route("/configurar-password", methods=["GET", "POST"])
def configurar_password():
    if hay_password_configurada():
        return redirect(url_for("login"))

    if request.method == "POST":
        password = request.form["password"]
        password2 = request.form["password2"]
        if password != password2:
            return render_template("configurar_password.html", error="Las contraseñas no coinciden")
        try:
            establecer_password(password)
        except ValueError as error:
            return render_template("configurar_password.html", error=str(error))
        session["autenticado"] = True
        return redirect(url_for("inicio"))

    return render_template("configurar_password.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if not hay_password_configurada():
        return redirect(url_for("configurar_password"))

    if request.method == "POST":
        if verificar_password(request.form["password"]):
            session["autenticado"] = True
            return redirect(url_for("inicio"))
        return render_template("login.html", error="Contraseña incorrecta")

    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


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
    filas = _con_sesiones_restantes(clientes)
    guardado = request.args.get("guardado")
    pendientes = sum(1 for f in filas if f["pendiente_pago"])
    return render_template(
        "index.html",
        clientes=filas,
        guardado=guardado,
        total_clientes=len(filas),
        total_pendientes=pendientes,
    )


@app.route("/cliente/<nombre>/firmar", methods=["POST"])
def firmar_sesion(nombre):
    """Confirma que un cliente ha hecho su sesión de PT hoy — descuenta del
    bono, guarda la fecha en su historial y suma la sesión a la economía de
    la semana, todo al momento (decisión de Fernando del 2026-07-22).

    `clave_idempotencia` (un valor de un solo uso generado al cargar la
    página del perfil) impide que un reintento de red o una doble pestaña
    guarden la misma firma dos veces — sprint de integridad, 2026-07-28."""
    clave_idempotencia = request.form.get("clave_idempotencia")
    try:
        resultado = registrar_sesion_pt(nombre, clave_idempotencia=clave_idempotencia)
    except sqlite3.OperationalError:
        return render_template(
            "error.html",
            mensaje="No se pudo registrar la sesión: la base de datos está ocupada. Vuelve a intentarlo.",
        ), 409
    except ValueError as error:
        return render_template("error.html", mensaje=str(error)), 400

    mensaje = f"sesión {resultado['numero_sesion']} de {resultado['sesiones_totales']}"
    if resultado["renovado"]:
        mensaje += " — ¡bono renovado!"
    return redirect(url_for("perfil_cliente", nombre=nombre, firmado=mensaje))


@app.route("/cliente/<nombre>")
def perfil_cliente(nombre):
    """Perfil de un cliente para Fernando: bono, botón de firmar sesión,
    enlace a editar y el historial, todo en una sola pantalla (decisión del
    2026-07-22 — antes estaba repartido entre la tarjeta de la lista, editar
    e historial por separado)."""
    clientes = leer_clientes()
    if nombre not in clientes:
        return f"No existe el cliente '{nombre}'", 404

    filas = _con_sesiones_restantes({nombre: clientes[nombre]})
    cliente = filas[0]
    cliente["token"] = clientes[nombre].get("token")
    return render_template(
        "perfil_cliente.html",
        nombre=nombre,
        cliente=cliente,
        clave_idempotencia=uuid.uuid4().hex,
        entradas=obtener_historial(nombre),
        firmado=request.args.get("firmado"),
        borrado=request.args.get("borrado"),
    )


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


@app.route("/mi/<token>")
def mi_perfil(token):
    """Página pública y personal de un cliente (milestone 4) — sin
    contraseña, solo con su enlace único. Ve su programa, sesiones y pagos
    (solo lectura), y desde el 2026-07-28 puede confirmar él mismo su
    sesión de hoy — ver `mi_firmar` más abajo."""
    encontrado = obtener_cliente_por_token(token)
    if encontrado is None:
        return render_template("error.html", mensaje="Este enlace no es válido. Pide uno nuevo a Fernando."), 404

    nombre, cliente = encontrado
    filas = _con_sesiones_restantes({nombre: cliente})
    return render_template(
        "mi_perfil.html",
        token=token,
        nombre=nombre,
        cliente=filas[0],
        entradas=obtener_historial(nombre),
        clave_idempotencia=uuid.uuid4().hex,
        firma_hoy=firma_de_hoy(nombre),
    )


@app.route("/mi/<token>/firmar", methods=["POST"])
def mi_firmar(token):
    """Confirma la sesión de PT de HOY para el propio cliente, desde su
    enlace personal — nunca otra fecha. El nombre se resuelve siempre a
    partir del token de la URL, nunca de un dato del formulario, así que
    solo se puede firmar la sesión del cliente dueño de ese enlace.

    Como mucho una firma por día desde aquí (decisión de Fernando,
    2026-07-28 — distinto del botón de Fernando, que sí permite varias al
    día). Si ya había firmado hoy, no es un error: `mi_perfil` ya sabe
    mostrar el recibo en vez del botón, así que basta con volver ahí."""
    encontrado = obtener_cliente_por_token(token)
    if encontrado is None:
        return render_template("error.html", mensaje="Este enlace no es válido. Pide uno nuevo a Fernando."), 404
    nombre, _cliente = encontrado

    clave_idempotencia = request.form.get("clave_idempotencia")
    try:
        firmar_sesion_publica(nombre, clave_idempotencia)
    except sqlite3.OperationalError:
        return render_template(
            "error.html",
            mensaje="No se pudo registrar la sesión: la base de datos está ocupada. Vuelve a intentarlo.",
        ), 409
    except ValueError:
        # Ya había firmado hoy (o un reintento llega tarde) — no hace falta
        # mostrar un error, la propia página vuelve a pintar el estado
        # correcto (el recibo o el mensaje de "ya has firmado").
        pass

    return redirect(url_for("mi_perfil", token=token))


@app.route("/cliente/<nombre>/historial/<int:entrada_id>/editar", methods=["GET", "POST"])
def editar_historial_ruta(nombre, entrada_id):
    """Corrige una entrada del historial ya guardada — para arreglar un
    número de sesión equivocado. Cada entrada se identifica por su `id`,
    no por su fecha — un cliente puede tener varias sesiones el mismo día
    (decisión de Fernando, 2026-07-24)."""
    if request.method == "POST":
        try:
            editar_sesion_pt(entrada_id, request.form["fecha"], int(request.form["numero_sesion"]))
        except sqlite3.OperationalError:
            return render_template(
                "error.html", mensaje="No se pudo guardar: la base de datos está ocupada. Reintenta."
            ), 409
        except ValueError as error:
            return render_template("error.html", mensaje=str(error)), 400
        return redirect(url_for("perfil_cliente", nombre=nombre))

    coincidencias = [entrada for entrada in obtener_historial(nombre) if entrada["id"] == entrada_id]
    if not coincidencias:
        return f"No existe esa entrada del historial de '{nombre}'", 404
    return render_template("editar_historial.html", nombre=nombre, entrada=coincidencias[0])


@app.route("/cliente/<nombre>/historial/<int:entrada_id>/eliminar", methods=["POST"])
def eliminar_historial_ruta(nombre, entrada_id):
    """Borra una entrada del historial y deshace su aportación económica de
    esa semana — p. ej. una firma duplicada por error."""
    try:
        resultado = eliminar_sesion_pt(entrada_id)
    except sqlite3.OperationalError:
        return render_template(
            "error.html", mensaje="No se pudo borrar: la base de datos está ocupada. Reintenta."
        ), 409
    except ValueError as error:
        return render_template("error.html", mensaje=str(error)), 400

    aviso = None
    if resultado.get("deshizo_renovacion"):
        aviso = "También se ha deshecho la renovación de bono que causó esta sesión — ya no queda pendiente de pago."
    return redirect(url_for("perfil_cliente", nombre=nombre, borrado=aviso))


@app.route("/cliente/<nombre>/historial")
def historial(nombre):
    """El historial ahora vive dentro del perfil del cliente — este enlace
    antiguo se queda por si alguien lo tenía guardado."""
    return redirect(url_for("perfil_cliente", nombre=nombre))


MESES_ES = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril", 5: "Mayo", 6: "Junio",
    7: "Julio", 8: "Agosto", 9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre",
}


def _etiqueta_mes(anio: int, mes: int) -> str:
    return f"{MESES_ES[mes]} {anio}"


@app.route("/economia")
def economia():
    hoy = hoy_negocio()

    semana = obtener_ultima_semana()
    mes = obtener_mes(hoy.year, hoy.month)
    meses_anteriores = [m for m in listar_meses() if (m["anio"], m["mes"]) != (hoy.year, hoy.month)]
    for m in meses_anteriores:
        m["etiqueta"] = _etiqueta_mes(m["anio"], m["mes"])

    return render_template(
        "economia.html",
        semana=semana,
        mes=mes,
        etiqueta_mes_actual=_etiqueta_mes(hoy.year, hoy.month),
        meses_anteriores=meses_anteriores,
        clase_registrada=request.args.get("clase_registrada"),
        clase_deshecha=request.args.get("clase_deshecha"),
    )


NOMBRES_CLASE = {"lidomare": "CrossFit Lidomare", "kids": "CrossFit Kids"}


@app.route("/clase/<tipo>/firmar", methods=["POST"])
def firmar_clase(tipo):
    """Cuenta una clase de grupo (no es de un cliente concreto) al momento
    de terminarla — ver `registrar_asistencia.py`."""
    if tipo not in NOMBRES_CLASE:
        return render_template("error.html", mensaje=f"Tipo de clase desconocido: {tipo}"), 400

    try:
        registrar_clase_grupo(tipo)
    except sqlite3.OperationalError:
        return render_template(
            "error.html",
            mensaje="No se pudo registrar la clase: la base de datos está ocupada. Vuelve a intentarlo.",
        ), 409

    return redirect(url_for("economia", clase_registrada=NOMBRES_CLASE[tipo]))


@app.route("/clase/<tipo>/deshacer", methods=["POST"])
def deshacer_clase(tipo):
    """Deshace la última clase de grupo de este tipo — p. ej. un toque de
    más en "+1 CrossFit Lidomare/Kids" (decisión de Fernando, 2026-07-24:
    hasta ahora las sesiones de PT se podían corregir pero las clases de
    grupo no)."""
    if tipo not in NOMBRES_CLASE:
        return render_template("error.html", mensaje=f"Tipo de clase desconocido: {tipo}"), 400

    try:
        deshecha = eliminar_ultima_clase_grupo(tipo)
    except sqlite3.OperationalError:
        return render_template(
            "error.html",
            mensaje="No se pudo deshacer: la base de datos está ocupada. Vuelve a intentarlo.",
        ), 409
    except ValueError as error:
        return render_template("error.html", mensaje=str(error)), 400

    return redirect(
        url_for("economia", clase_deshecha=f"{NOMBRES_CLASE[tipo]} del {deshecha['fecha']}")
    )


@app.route("/admin/procesar-dia", methods=["POST"])
def admin_procesar_dia():
    """Llamada por la rutina automática diaria (una nube de Claude Code, no
    un navegador): procesa las sesiones de un día y las suma a la semana en
    curso. Protegida con un token de máquina, no con la contraseña de
    Fernando — ver `webapp/auth.py` y decisión del 2026-07-21."""
    token = request.headers.get("X-Admin-Token")
    if token != obtener_admin_token():
        return jsonify({"error": "token inválido"}), 401

    datos = request.get_json(force=True, silent=True) or {}
    fecha = datos.get("fecha")
    eventos = datos.get("eventos")
    if not fecha or eventos is None:
        return jsonify({"error": "faltan 'fecha' o 'eventos' en el cuerpo de la petición"}), 400

    try:
        resultado = procesar_dia(eventos, fecha)
    except sqlite3.OperationalError:
        return jsonify({"error": "base de datos ocupada, reintenta"}), 409

    return jsonify(resultado)


@app.context_processor
def _inyectar_avisos_no_leidos():
    if not session.get("autenticado"):
        return {}
    return {"avisos_no_leidos": contar_no_leidos()}


@app.route("/admin/verificar-semana", methods=["POST"])
def admin_verificar_semana():
    """Comprobación semanal contra Calendar (decisión de Fernando del
    2026-07-22): solo lectura, nunca corrige nada — cualquier diferencia
    entre lo firmado en la app y lo que hay en Calendar se guarda como
    aviso. La llamo yo mismo cuando Fernando pide revisar la semana, con
    los eventos reales de Calendar (nunca inventados)."""
    token = request.headers.get("X-Admin-Token")
    if token != obtener_admin_token():
        return jsonify({"error": "token inválido"}), 401

    datos = request.get_json(force=True, silent=True) or {}
    eventos = datos.get("eventos")
    fecha_referencia = datos.get("fecha_referencia")
    if eventos is None or not fecha_referencia:
        return jsonify({"error": "faltan 'eventos' o 'fecha_referencia' en el cuerpo de la petición"}), 400

    try:
        resultado = verificar_semana(eventos, datetime.strptime(fecha_referencia, "%Y-%m-%d"))
    except sqlite3.OperationalError:
        return jsonify({"error": "base de datos ocupada, reintenta"}), 409

    return jsonify(resultado)


@app.route("/admin/backup")
def admin_backup():
    """Descarga la base de datos completa (`antifragil.db`) — para la copia
    de seguridad diaria automática a Google Drive (decisión de Fernando,
    2026-07-28: quiere los datos de clientes/economía a salvo aunque pase
    algo con el servidor). Protegida con el mismo token de máquina a
    máquina que el resto de rutas /admin/*, no con la contraseña personal
    de Fernando.

    No entrega el archivo vivo directamente: en modo WAL, leer el archivo
    principal mientras otra petición está escribiendo podría copiar un
    estado a medio guardar. Se usa la API de backup de SQLite
    (`sqlite3.Connection.backup`) para generar una "foto" consistente en un
    archivo temporal, se envía esa foto, y se borra después (sprint de
    integridad, 2026-07-28)."""
    token = request.headers.get("X-Admin-Token")
    if token != obtener_admin_token():
        return jsonify({"error": "token inválido"}), 401

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as archivo_temporal:
        ruta_temporal = Path(archivo_temporal.name)
    try:
        origen = sqlite3.connect(RUTA_POR_DEFECTO)
        destino = sqlite3.connect(ruta_temporal)
        with destino:
            origen.backup(destino)
        origen.close()
        destino.close()
        return send_file(ruta_temporal, as_attachment=True, download_name="antifragil.db")
    finally:
        @after_this_request
        def _borrar_temporal(response):
            ruta_temporal.unlink(missing_ok=True)
            return response


@app.route("/admin/debug", methods=["POST"])
def admin_debug():
    """Ruta temporal de diagnóstico para la puesta en marcha de la
    actualización diaria (2026-07-21) — la rutina en la nube manda aquí un
    informe de qué ve disponible, para poder depurar sin que Fernando tenga
    que mirar nada él mismo. Se puede borrar una vez la rutina funcione bien."""
    token = request.headers.get("X-Admin-Token")
    if token != obtener_admin_token():
        return jsonify({"error": "token inválido"}), 401

    datos = request.get_json(force=True, silent=True) or {}
    mensaje = datos.get("mensaje", "(sin mensaje)")
    registrar_aviso(hoy_negocio().isoformat(), "debug_rutina", mensaje)
    return jsonify({"ok": True})


@app.route("/avisos")
def avisos():
    lista = listar_avisos_pendientes()
    marcar_todos_leidos()
    return render_template("avisos.html", avisos=lista)


@app.route("/avisos/<int:aviso_id>/resolver", methods=["POST"])
def resolver_aviso_ruta(aviso_id):
    resolver_aviso(aviso_id)
    return redirect(url_for("avisos"))


if __name__ == "__main__":
    # debug=False a propósito: esta app va a quedar arrancada de forma
    # permanente (arranque automático), y el modo de depuración de Flask
    # deja accesible una consola que podría ejecutar código arbitrario si
    # algún día la app fuera visible desde la red — ver
    # docs/APRENDIZAJE_WEBAPP.md.
    app.run(debug=False)
