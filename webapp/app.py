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

import os
import secrets
import sqlite3
import tempfile
import uuid
from datetime import datetime
from pathlib import Path

from zona_horaria import hoy_negocio

from flask import Flask, after_this_request, jsonify, redirect, render_template, request, send_file, session, url_for

from avisos import (
    contar_no_leidos,
    listar_avisos_pendientes,
    marcar_todos_leidos,
    registrar_aviso,
    resolver_aviso,
    resolver_avisos_por_tipo,
)
from basedatos import RUTA_POR_DEFECTO, crear_esquema
from migrar_programas_cliente import rellenar_si_falta
from migrar_modalidades import rellenar_si_falta as rellenar_modalidades
from reparar_numeracion import reparar_si_hace_falta
from clientes.repositorio import (
    ESTADO_POR_DEFECTO,
    ESTADOS_VALIDOS,
    actualizar_cliente,
    asegurar_ciclos_mensuales,
    asegurar_tokens,
    configurar_servicio,
    crear_cliente,
    leer_clientes,
    listar_tipos_programa,
    deuda_pendiente,
    marcar_pago_del_ciclo,
    obtener_ciclo_actual,
    obtener_cliente_por_token,
    obtener_historial,
    obtener_programas_cliente,
    validar_estado,
)
from servicios.modalidades import (
    BONO,
    ETIQUETAS as ETIQUETAS_MODALIDAD,
    MODALIDAD_POR_DEFECTO,
    MODALIDADES,
    datos_que_faltan,
    ficha_servicio,
    puede_firmarse,
    resumen_ciclo,
    validar_condiciones,
)
from economia.registro import listar_meses, obtener_mes, obtener_ultima_semana
from firma_publica import (
    avisar_confirmaciones_pendientes,
    confirmaciones_de_hoy,
    confirmar_sesion_publica,
    hay_sesion_pendiente_de_confirmar,
)
from procesar_dia import procesar_dia
from registrar_asistencia import (
    editar_sesion_pt,
    eliminar_cliente_con_historial,
    eliminar_sesion_pt,
    eliminar_ultima_clase_grupo,
    registrar_clase_grupo,
    registrar_sesion_pt,
)
from verificar_semana import verificar_semana
from webapp.auth import (
    establecer_password,
    hay_password_configurada,
    obtener_secret_key,
    token_admin_valido,
    verificar_password,
)

crear_esquema()  # crea las tablas si es la primera vez que arranca en esta máquina (ej. un servidor nuevo)
asegurar_tokens()  # da un enlace personal a clientes dados de alta antes del milestone 4
rellenar_si_falta()  # reconstruye los bonos pasados la primera vez que arranca esta versión (2026-08-02)
rellenar_modalidades()  # completa el precio total de los bonos ya existentes (2026-08-03)
# Cuadra la numeración que quedó descolocada por borrados anteriores a la
# corrección del 2026-08-04. No toca la economía y es segura de repetir.
reparar_numeracion_pendiente = reparar_si_hace_falta()
# Abre el ciclo del mes en curso a los clientes de mensualidad y cuenta. Es
# idempotente, así que arrancar la web mil veces no duplica ninguna cuota.
# (se hace en `_abrir_mes_si_toca`, la primera vez que se abre la lista)

app = Flask(__name__)
app.secret_key = obtener_secret_key()
# El CSS, el logo y la tipografía casi nunca cambian — sin esto, el
# navegador los volvía a descargar en cada página (iba notablemente más
# lenta). Una semana de caché es un buen equilibrio para un proyecto que
# cambia de vez en cuando, no cada día.
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 60 * 60 * 24 * 7

# Cookies de sesión endurecidas (segunda auditoría, 2026-07-30):
# - HttpOnly: el JavaScript de la página no puede leer la cookie, así que un
#   script inyectado no puede robar la sesión.
# - Secure: el navegador solo la manda por HTTPS, nunca en claro. Se puede
#   desactivar con ANTIFRAGIL_COOKIES_INSEGURAS=1 para probar en local
#   (http://localhost), donde no hay HTTPS.
# - SameSite=Lax: la cookie no viaja en peticiones que vengan de otra web,
#   que es la base de los ataques de formulario cruzado (CSRF).
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("ANTIFRAGIL_COOKIES_INSEGURAS") != "1"


def _version_estaticos() -> str:
    """Huella de la hoja de estilos, para añadirla al enlace del CSS en
    las plantillas (`?v=...`).

    Sin esto, la caché de una semana de arriba juega en contra al
    desplegar un cambio de diseño: el navegador sigue usando el CSS
    viejo hasta que caduque (o hasta un Ctrl+F5 manual), así que una
    página nueva se ve sin estilos. Pasó de verdad el 2026-07-29 con la
    tarjeta del QR. Como la huella cambia sola al cambiar el archivo, el
    navegador descarga la versión nueva justo cuando toca, y sigue
    reutilizando la guardada el resto del tiempo."""
    try:
        estatico = Path(app.static_folder)
        # Se mira la fecha del archivo más reciente entre la hoja de estilos
        # y el script de carga: si solo se toca uno de los dos, la huella
        # tiene que cambiar igualmente para que el navegador lo descargue.
        return str(int(max((estatico / n).stat().st_mtime for n in ("style.css", "carga.js"))))
    except OSError:
        return "0"


VERSION_ESTATICOS = _version_estaticos()


@app.context_processor
def _inyectar_version_estaticos():
    return {"version_estaticos": VERSION_ESTATICOS}


# Rutas que no piden la contraseña de sesión. Las de máquina
# (`/admin/verificar-semana`, `/admin/backup`) las llama una rutina
# automática, no un navegador: se protegen con su propio token, comprobado
# dentro de cada función. `mi_perfil` y `mi_confirmar` son el enlace personal
# de cada cliente y el destino de su QR (su token hace de llave).
# `admin_procesar_dia` sigue en la lista solo para poder responder 410 a lo
# que aún la llame — ya no procesa nada.
RUTAS_PUBLICAS = {
    "login", "configurar_password", "static", "admin_procesar_dia",
    "admin_verificar_semana", "admin_backup", "mi_perfil", "mi_confirmar",
}


# Rutas de máquina (las llama una rutina automática con X-Admin-Token, no un
# navegador con cookies): no pueden llevar token CSRF porque no hay
# formulario ni sesión detrás, y no les hace falta — un ataque de formulario
# cruzado se aprovecha de la cookie de sesión de la víctima, y aquí no hay
# ninguna. Son las ÚNICAS excluidas de la comprobación CSRF.
RUTAS_MAQUINA = {"admin_procesar_dia", "admin_verificar_semana", "admin_backup"}


def token_csrf() -> str:
    """Token de un solo uso por sesión, para incrustar en cada formulario de
    escritura. Se guarda en la sesión (que va en una cookie firmada), así que
    otra web no puede leerlo ni adivinarlo — y sin él no se acepta ningún
    POST."""
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(32)
    return session["csrf"]


@app.template_filter("fecha_es")
def _fecha_es(valor: str) -> str:
    """2026-07-22 -> 22/07/2026, que es como se lee una fecha en España.
    Si el dato no tiene la forma esperada se devuelve tal cual, sin
    romper la página."""
    try:
        return datetime.strptime(str(valor), "%Y-%m-%d").strftime("%d/%m/%Y")
    except (ValueError, TypeError):
        return str(valor)


MESES_ES = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril", 5: "Mayo", 6: "Junio",
    7: "Julio", 8: "Agosto", 9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre",
}


def _euros(valor) -> str:
    if valor is None:
        return "—"
    return f"{float(valor):,.2f} €".replace(",", "·").replace(".", ",").replace("·", ".")


@app.template_filter("euros")
def _filtro_euros(valor) -> str:
    """1234.5 -> 1.234,50 €, que es como se escribe una cantidad en España."""
    return _euros(valor)


@app.template_filter("mes_es")
def _filtro_mes(valor) -> str:
    """8 -> agosto."""
    try:
        return MESES_ES[int(valor)]
    except (TypeError, ValueError, KeyError):
        return str(valor)


@app.context_processor
def _inyectar_token_csrf():
    """Disponible en todas las plantillas como `token_csrf`."""
    return {"token_csrf": token_csrf}


@app.before_request
def _requerir_login():
    """Se ejecuta antes de cada petición. Antes de que esta web sea visible
    desde internet, hace falta al menos una contraseña — si no, cualquiera
    con el enlace podría ver y editar los datos de los clientes.

    Comprueba además el token CSRF en toda escritura (segunda auditoría,
    2026-07-30): sin esto, otra web podía tener un formulario oculto que, al
    visitarla con la sesión abierta, mandara un POST a esta app (borrar una
    sesión, cambiar un cliente) usando la cookie del navegador sin que
    Fernando se enterara."""
    # `endpoint is None` = la URL no existe: se deja pasar para que Flask
    # responda su 404 de siempre, en vez de un 400 de CSRF que haría parecer
    # que la ruta existe.
    if (
        request.method in ("POST", "PUT", "PATCH", "DELETE")
        and request.endpoint is not None
        and request.endpoint not in RUTAS_MAQUINA
    ):
        esperado = session.get("csrf")
        recibido = request.form.get("csrf") or request.headers.get("X-CSRF-Token") or ""
        if not esperado or not secrets.compare_digest(recibido, esperado):
            return render_template(
                "error.html",
                mensaje=(
                    "La página había caducado y no se ha guardado nada, por seguridad. "
                    "Vuelve atrás, recarga la página e inténtalo otra vez."
                ),
            ), 400

    if request.endpoint in RUTAS_PUBLICAS:
        return None

    if not hay_password_configurada():
        return redirect(url_for("configurar_password"))

    if not session.get("autenticado"):
        return redirect(url_for("login"))

    return None


@app.route("/configurar-password", methods=["GET", "POST"])
def configurar_password():
    """Alta de la contraseña la primera vez.

    Pide además el token de instalación (`ANTIFRAGIL_SETUP_TOKEN`) desde la
    segunda auditoría (2026-07-30). Antes, una instalación nueva (un
    servidor recién montado, o una base de datos restaurada sin la tabla de
    configuración) dejaba esta pantalla abierta a cualquiera que llegara
    primero: el visitante ponía su propia contraseña y se quedaba con el
    control de los datos de los clientes. Ahora sin ese token no se puede
    completar, así que una ventana de instalación abierta no basta para
    entrar."""
    if hay_password_configurada():
        return redirect(url_for("login"))

    token_esperado = os.environ.get("ANTIFRAGIL_SETUP_TOKEN")

    if request.method == "POST":
        if not token_esperado:
            return render_template(
                "configurar_password.html",
                error=(
                    "Falta configurar ANTIFRAGIL_SETUP_TOKEN en el servidor. "
                    "Sin esa clave de instalación no se puede crear la contraseña."
                ),
            ), 403
        if not secrets.compare_digest(request.form.get("token_instalacion", ""), token_esperado):
            return render_template("configurar_password.html", error="Clave de instalación incorrecta"), 403

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
                "estado": datos.get("estado") or ESTADO_POR_DEFECTO,
                # Servicios anteriores ya cerrados que siguen sin cobrarse.
                "ciclos_pendientes": datos.get("ciclos_pendientes") or 0,
                # Condiciones del servicio en curso (2026-08-03). Esta función
                # copia claves una a una, así que lo que no se nombre aquí NO
                # llega a la pantalla — el precio del bono y el periodo de una
                # mensualidad desaparecían en silencio.
                "modalidad": datos.get("modalidad") or MODALIDAD_POR_DEFECTO,
                "sesiones_ciclo": datos.get("sesiones_ciclo") or 0,
                "precio_total": datos.get("precio_total"),
                "cuota_mensual": datos.get("cuota_mensual"),
                "sesiones_referencia": datos.get("sesiones_referencia"),
                "anio": datos.get("anio"),
                "mes": datos.get("mes"),
            }
        )
    # «Debe algo» junta las dos deudas posibles: la del servicio en curso y
    # la de cualquier servicio anterior que quedara sin cobrar. Antes la lista
    # solo miraba el primero, así que un cliente con la cuenta del mes pasado
    # a deber pero la de este mes al día NO salía como pendiente (lo detectó
    # Fernando con Samanta, 2026-08-04).
    for fila in filas:
        fila["debe_algo"] = fila["pendiente_pago"] or fila["ciclos_pendientes"] > 0
    return filas


def _es_si(valor) -> bool:
    return str(valor or "").strip().lower() in ("sí", "si")


# Mes que ya se ha comprobado en este proceso. Ver `_abrir_mes_si_toca`.
_MES_COMPROBADO: tuple[int, int] | None = None


def _abrir_mes_si_toca() -> None:
    """Abre el ciclo del mes a los clientes de mensualidad y cuenta, como
    mucho una vez por mes y proceso.

    Sin este recuerdo, la lista de clientes —la pantalla que más se abre—
    hacía una consulta extra en CADA carga para descubrir que no había nada
    que hacer: pasó de 3 consultas y 5,8 ms a 4 y 16,5 ms (medido con
    `comprobar_rendimiento.py`, 2026-08-03).

    Olvidarlo no rompe nada: la operación es idempotente, así que si el
    servidor se reinicia simplemente se vuelve a comprobar una vez. Y un
    cliente que se configure como mensualidad a mitad de mes cobra su cuota
    en el propio `configurar_servicio`, no aquí."""
    global _MES_COMPROBADO
    hoy = hoy_negocio()
    if _MES_COMPROBADO == (hoy.year, hoy.month):
        return
    asegurar_ciclos_mensuales(hoy.year, hoy.month)
    _MES_COMPROBADO = (hoy.year, hoy.month)


@app.route("/")
def inicio():
    _abrir_mes_si_toca()
    avisar_confirmaciones_pendientes()
    clientes = leer_clientes()
    filas = _con_sesiones_restantes(clientes)

    # Los cuatro contadores son TOTALES generales y no cambian al filtrar:
    # dicen cuántos hay de cada cosa, no cuántos se están viendo. «Pendientes
    # de pago» cuenta a cualquiera que deba dinero, esté activo, pausado o
    # cancelado — la deuda no desaparece por dejar de entrenar.
    conteos = {
        "activos": sum(1 for f in filas if f["estado"] == "activo"),
        "pendientes": sum(1 for f in filas if f["debe_algo"]),
        "pausados": sum(1 for f in filas if f["estado"] == "pausado"),
        "cancelados": sum(1 for f in filas if f["estado"] == "cancelado"),
    }

    return render_template(
        "index.html",
        clientes=filas,
        guardado=request.args.get("guardado"),
        eliminado=request.args.get("eliminado"),
        conteos=conteos,
    )


@app.route("/cliente/<nombre>/firmar", methods=["POST"])
def firmar_sesion(nombre):
    """Confirma que un cliente ha hecho su sesión de PT hoy — descuenta del
    bono, guarda la fecha en su historial y suma la sesión a la economía de
    la semana, todo al momento (decisión de Fernando del 2026-07-22).

    `clave_idempotencia` (un valor de un solo uso generado al cargar la
    página del perfil) impide que un reintento de red o una doble pestaña
    guarden la misma firma dos veces — sprint de integridad, 2026-07-28.

    Un cliente pausado o cancelado no puede firmar. Se comprueba AQUÍ, en el
    servidor, además de ocultar el botón: esconder un botón no impide llamar
    a la ruta directamente, y esta operación descuenta bono, escribe
    historial y mueve dinero (2026-08-01)."""
    cliente = leer_clientes().get(nombre)
    if cliente is None:
        return render_template("error.html", mensaje=f"No existe el cliente '{nombre}'"), 404

    estado = cliente.get("estado") or ESTADO_POR_DEFECTO
    if estado != "activo":
        motivo = (
            "No se puede firmar una sesión mientras el cliente está pausado."
            if estado == "pausado"
            else "No se puede firmar una sesión de un cliente cancelado."
        )
        return render_template("error.html", mensaje=motivo), 409

    # La misma regla que decide si se enseña el botón se comprueba AQUÍ, en
    # el servidor: esconder un botón no impide llamar a la ruta a mano, y
    # esta operación escribe historial y mueve dinero.
    ciclo = obtener_ciclo_actual(nombre)
    if not puede_firmarse(ciclo, estado):
        faltan = datos_que_faltan(ciclo) if ciclo else ["el servicio del cliente"]
        return render_template(
            "error.html",
            mensaje=(
                f"A '{nombre}' le falta {' y '.join(faltan)} — rellénalo en «Editar programa» "
                f"antes de firmar sesiones."
            ),
        ), 409

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

    # "sesión 3 de 5" solo tiene sentido en un bono. Una mensualidad o una
    # cuenta no tienen tope, y decir "sesión 3 de 0" era absurdo.
    if resultado.get("modalidad") == BONO and resultado.get("sesiones_totales"):
        mensaje = f"sesión {resultado['numero_sesion']} de {resultado['sesiones_totales']}"
        if resultado["renovado"]:
            mensaje += " — ¡bono renovado!"
    else:
        periodo = MESES_ES.get(resultado.get("mes") or 0, "").lower()
        mensaje = f"sesión {resultado['numero_sesion']}"
        if periodo:
            mensaje += f" de {periodo}"
        mensaje += " registrada"
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

    # El historial ya viene agrupado dentro de cada bono, así que no hace
    # falta pedirlo otra vez suelto.
    firmado = request.args.get("firmado")

    # Cada ciclo se traduce a lo que hay que enseñar según su modalidad, para
    # que la plantilla no tenga que decidir nada.
    ciclos = obtener_programas_cliente(nombre)
    for ciclo in ciclos:
        ciclo["resumen"] = resumen_ciclo(ciclo, len(ciclo["sesiones"]))

    actual = next((c for c in ciclos if c.get("es_actual")), None)

    # UNA sola estructura para toda la ficha, construida desde el CICLO EN
    # CURSO (2026-08-04). Antes la plantilla mezclaba el ciclo con los campos
    # heredados de `clientes` y podían contradecirse — el formulario guardaba
    # bien y la pantalla seguía enseñando lo viejo.
    ficha = ficha_servicio(
        actual,
        sesiones_del_ciclo=len(actual["sesiones"]) if actual else 0,
        sesiones_completadas=cliente.get("sesiones_completadas"),
        estado=cliente["estado"],
        pendiente_pago=cliente["pendiente_pago"],
    )

    return render_template(
        "perfil_cliente.html",
        ficha=ficha,
        puede_firmar=ficha["puede_firmar"],
        nombre=nombre,
        cliente=cliente,
        clave_idempotencia=uuid.uuid4().hex,
        firmado=firmado,
        borrado=request.args.get("borrado"),
        cobro=request.args.get("cobro"),
        # El QR solo sale justo después de firmar; el resto de las veces ni
        # se pregunta, que es una consulta menos en cada visita.
        hay_sesion_pendiente=bool(firmado) and hay_sesion_pendiente_de_confirmar(nombre),
        confirmaciones_hoy=confirmaciones_de_hoy(nombre),
        bonos=ciclos,
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
            estado=request.form.get("estado") or ESTADO_POR_DEFECTO,
        )
    except sqlite3.OperationalError:
        return render_template(
            "error.html",
            mensaje="No se pudo guardar: la base de datos está ocupada ahora mismo. Vuelve a intentarlo en unos segundos.",
        ), 409
    except ValueError as error:
        return render_template("error.html", mensaje=str(error)), 400

    return redirect(url_for("inicio", guardado=request.form["nombre"]))


@app.route("/cliente/<nombre>/eliminar")
def eliminar_cliente_confirmar(nombre):
    """Pantalla de "vas a borrar esto" antes de retirar un cliente — misma
    regla que el resto de escrituras del proyecto: nunca se borra nada
    directamente desde un enlace (decisión de Fernando, 2026-07-29, para
    poder retirar los clientes de prueba)."""
    clientes = leer_clientes()
    if nombre not in clientes:
        return f"No existe el cliente '{nombre}'", 404

    entradas = obtener_historial(nombre)
    return render_template(
        "eliminar_cliente.html",
        nombre=nombre,
        total_sesiones=len(entradas),
        importe=sum(entrada["tarifa"] or 0 for entrada in entradas),
    )


@app.route("/cliente/<nombre>/eliminar/confirmar", methods=["POST"])
def eliminar_cliente_ruta(nombre):
    """Borra el cliente y todas sus sesiones, descontando su facturación de
    cada semana afectada (ver `eliminar_cliente_con_historial`)."""
    try:
        resultado = eliminar_cliente_con_historial(nombre)
    except sqlite3.OperationalError:
        return render_template(
            "error.html", mensaje="No se pudo borrar: la base de datos está ocupada. Reintenta."
        ), 409
    except ValueError as error:
        return render_template("error.html", mensaje=str(error)), 400

    mensaje = f"{nombre} — {resultado['sesiones_borradas']} sesiones"
    if resultado["importe_descontado"]:
        mensaje += f" y {resultado['importe_descontado']:.0f}€ descontados de la economía"
    return redirect(url_for("inicio", eliminado=mensaje))


@app.route("/cliente/<nombre>/pago", methods=["POST"])
def cambiar_pago(nombre):
    """Marca el servicio en curso como cobrado o pendiente, desde la ficha.

    Solo toca el estado de COBRO. No cambia sesiones, ni horas, ni
    historial, ni facturación, ni precio medio — ni hacia adelante ni hacia
    atrás. Cobrar más tarde no hace que el trabajo se haya hecho más tarde.
    La confirmación («¿seguro?») la pide el navegador antes de enviar."""
    if nombre not in leer_clientes():
        return render_template("error.html", mensaje=f"No existe el cliente '{nombre}'"), 404

    pagado = request.form.get("pagado") == "si"
    try:
        # Cambia el estado de COBRO y nada más: no toca sesiones, ni
        # historial, ni economía. Se escribe en los dos sitios (la ficha del
        # cliente y su ciclo en curso) para que no puedan contradecirse.
        marcar_pago_del_ciclo(nombre, pagado)
    except sqlite3.OperationalError:
        return render_template(
            "error.html", mensaje="No se pudo guardar: la base de datos está ocupada. Reintenta."
        ), 409
    except ValueError as error:
        return render_template("error.html", mensaje=str(error)), 400

    return redirect(url_for("perfil_cliente", nombre=nombre))


@app.route("/cliente/<nombre>/ciclo/<int:ciclo>/pago", methods=["POST"])
def cambiar_pago_ciclo(nombre, ciclo):
    """Marca como cobrado o pendiente CUALQUIER servicio del historial, no
    solo el que está en curso (2026-08-04).

    Hacía falta porque en el negocio real se paga después: una cuenta de
    cliente se cobra al terminar el mes, y un bono puede quedar a deber una
    vez agotado. Antes, al cerrarse el ciclo su estado quedaba congelado y
    esa deuda no había forma de saldarla.

    Solo cambia el estado de COBRO. No toca sesiones, horas, historial,
    facturación ni precio medio."""
    if nombre not in leer_clientes():
        return render_template("error.html", mensaje=f"No existe el cliente '{nombre}'"), 404

    pagado = request.form.get("pagado") == "si"
    try:
        marcar_pago_del_ciclo(nombre, pagado, ciclo=ciclo)
    except sqlite3.OperationalError:
        return render_template(
            "error.html", mensaje="No se pudo guardar: la base de datos está ocupada. Reintenta."
        ), 409
    except ValueError as error:
        return render_template("error.html", mensaje=str(error)), 400

    return redirect(url_for("perfil_cliente", nombre=nombre, cobro=ciclo))


@app.route("/cliente/<nombre>/editar-datos")
def editar_datos(nombre):
    """Datos del propio cliente: nombre y estado. La eliminación vive aquí
    dentro, en una zona aparte — fuera de la ficha principal, que es una
    pantalla de uso diario (2026-08-02)."""
    clientes = leer_clientes()
    if nombre not in clientes:
        return f"No existe el cliente '{nombre}'", 404
    cliente = clientes[nombre]
    return render_template(
        "editar_datos.html",
        nombre=nombre,
        cliente=cliente,
        estado=cliente.get("estado") or ESTADO_POR_DEFECTO,
        estados=ESTADOS_VALIDOS,
        tiene_historial=bool(obtener_historial(nombre)),
    )


def _detalle_servicio(datos: dict) -> str:
    """Una frase que resume las condiciones de un servicio, para las
    pantallas de revisión. En lenguaje llano, no en columnas de tabla."""
    modalidad = datos.get("modalidad") or MODALIDAD_POR_DEFECTO

    if modalidad == "mensualidad":
        texto = f"Cuota de {_euros(datos.get('cuota_mensual'))} al mes"
        if datos.get("sesiones_referencia"):
            texto += f" · {datos['sesiones_referencia']} sesiones de referencia"
        return texto

    if modalidad == "cuenta":
        return f"{_euros(datos.get('tarifa'))} por sesión · sin tope de sesiones"

    totales = datos.get("sesiones_totales") or 0
    if not totales:
        return "Sin condiciones rellenas todavía"
    return (
        f"{totales} sesiones por {_euros(datos.get('precio_total'))} "
        f"· {_euros(datos.get('tarifa'))} por sesión"
    )


def _servicio_del_formulario(formulario) -> dict:
    """Lee los campos del formulario de servicio. Los que no son de la
    modalidad elegida van deshabilitados en el navegador y no llegan, así
    que se leen con `get` y se quedan vacíos."""
    return {
        "modalidad": formulario.get("modalidad") or MODALIDAD_POR_DEFECTO,
        "nombre_servicio": (formulario.get("nombre_servicio") or "").strip(),
        "sesiones_totales": formulario.get("sesiones_totales") or "",
        "precio_total": formulario.get("precio_total") or "",
        "cuota_mensual": formulario.get("cuota_mensual") or "",
        "sesiones_referencia": formulario.get("sesiones_referencia") or "",
        "tarifa": formulario.get("tarifa") or "",
        "sesiones_completadas": formulario.get("sesiones_completadas") or "",
        "pendiente_pago": (
            "pendiente_pago" in formulario
            if formulario.get("pendiente_pago") is None
            else formulario.get("pendiente_pago") == "si"
        ),
    }


@app.route("/cliente/<nombre>/editar")
def editar(nombre):
    """«Editar programa»: la modalidad del servicio y sus condiciones.

    Desde el 2026-08-03 las condiciones se guardan en el propio cliente, no
    se eligen de una lista global — cada uno puede tener las suyas."""
    clientes = leer_clientes()
    if nombre not in clientes:
        return f"No existe el cliente '{nombre}'", 404
    cliente = clientes[nombre]
    ciclo = obtener_ciclo_actual(nombre) or {}
    return render_template(
        "editar.html",
        nombre=nombre,
        cliente=cliente,
        ciclo=ciclo,
        modalidad=cliente.get("modalidad") or MODALIDAD_POR_DEFECTO,
        modalidades=[(clave, ETIQUETAS_MODALIDAD[clave]) for clave in MODALIDADES],
        pendiente_pago=_es_si(cliente.get("pendiente_pago")),
        estado=cliente.get("estado") or ESTADO_POR_DEFECTO,
        estados=ESTADOS_VALIDOS,
    )


@app.route("/cliente/<nombre>/servicio/confirmar", methods=["POST"])
def confirmar_servicio(nombre):
    """Enseña qué va a pasar ANTES de tocar nada. Si cambia la modalidad,
    lo dice con todas las letras: el ciclo actual se cierra."""
    clientes = leer_clientes()
    if nombre not in clientes:
        return render_template("error.html", mensaje=f"No existe el cliente '{nombre}'"), 404

    actual = clientes[nombre]
    formulario = _servicio_del_formulario(request.form)

    # Las condiciones se validan aquí, antes de enseñar nada: más vale
    # decir "faltan las sesiones del bono" ahora que guardar un servicio
    # incoherente y descubrirlo en la facturación.
    try:
        condiciones = validar_condiciones(
            formulario["modalidad"],
            sesiones_totales=formulario["sesiones_totales"] or None,
            precio_total=formulario["precio_total"] or None,
            cuota_mensual=formulario["cuota_mensual"] or None,
            tarifa=formulario["tarifa"] or None,
            sesiones_referencia=formulario["sesiones_referencia"] or None,
        )
    except ValueError as error:
        return render_template("error.html", mensaje=str(error)), 400

    modalidad_actual = actual.get("modalidad") or MODALIDAD_POR_DEFECTO
    return render_template(
        "confirmar_servicio.html",
        nombre=nombre,
        formulario=formulario,
        cambia_modalidad=modalidad_actual != formulario["modalidad"],
        antes={
            "modalidad": modalidad_actual,
            "etiqueta": ETIQUETAS_MODALIDAD[modalidad_actual],
            "nombre_servicio": actual.get("tipo_programa"),
            "detalle": _detalle_servicio(actual),
            "sesiones_ciclo": actual.get("sesiones_ciclo") or 0,
            "pendiente_pago": _es_si(actual.get("pendiente_pago")),
        },
        despues={
            "modalidad": formulario["modalidad"],
            "etiqueta": ETIQUETAS_MODALIDAD[formulario["modalidad"]],
            "nombre_servicio": formulario["nombre_servicio"] or actual.get("tipo_programa"),
            "detalle": _detalle_servicio(condiciones),
        },
    )


@app.route("/cliente/<nombre>/servicio/guardar", methods=["POST"])
def guardar_servicio(nombre):
    formulario = _servicio_del_formulario(request.form)
    try:
        configurar_servicio(
            nombre,
            formulario["modalidad"],
            nombre_servicio=formulario["nombre_servicio"] or None,
            sesiones_totales=formulario["sesiones_totales"] or None,
            precio_total=formulario["precio_total"] or None,
            cuota_mensual=formulario["cuota_mensual"] or None,
            tarifa=formulario["tarifa"] or None,
            sesiones_referencia=formulario["sesiones_referencia"] or None,
            pendiente_pago=formulario["pendiente_pago"],
            hoy=hoy_negocio(),
        )
        # Las sesiones ya consumidas solo existen en un bono, y se corrigen
        # aparte para no mezclarlas con el cambio de condiciones.
        if formulario["modalidad"] == BONO and formulario["sesiones_completadas"] != "":
            actual = leer_clientes()[nombre]
            actualizar_cliente(
                nombre=nombre,
                nuevo_nombre=nombre,
                tipo_programa=actual["tipo_programa"],
                sesiones_completadas=int(formulario["sesiones_completadas"]),
                pendiente_pago=formulario["pendiente_pago"],
            )
    except sqlite3.OperationalError:
        return render_template(
            "error.html", mensaje="No se pudo guardar: la base de datos está ocupada. Reintenta."
        ), 409
    except ValueError as error:
        return render_template("error.html", mensaje=str(error)), 400

    return redirect(url_for("perfil_cliente", nombre=nombre))


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
    nuevo_estado = validar_estado(request.form.get("estado") or ESTADO_POR_DEFECTO)

    return render_template(
        "confirmar.html",
        nombre=nombre,
        antes={
            "nombre": nombre,
            "tipo_programa": actual.get("tipo_programa"),
            "sesiones_completadas": actual.get("sesiones_completadas"),
            "pendiente_pago": _es_si(actual.get("pendiente_pago")),
            "estado": actual.get("estado") or ESTADO_POR_DEFECTO,
        },
        despues={
            "nombre": nuevo_nombre,
            "tipo_programa": nuevo_tipo_programa,
            "sesiones_completadas": nuevas_sesiones_completadas,
            "pendiente_pago": nuevo_pendiente_pago,
            "estado": nuevo_estado,
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
            estado=request.form.get("estado") or ESTADO_POR_DEFECTO,
        )
    except sqlite3.OperationalError:
        return render_template(
            "error.html",
            mensaje="No se pudo guardar: la base de datos está ocupada ahora mismo. Vuelve a intentarlo en unos segundos.",
        ), 409
    except ValueError as error:
        return render_template("error.html", mensaje=str(error)), 400

    # Se vuelve a la ficha del cliente, no a la lista general: casi siempre
    # se sigue trabajando sobre el mismo cliente.
    return redirect(url_for("perfil_cliente", nombre=request.form["nombre"]))


@app.route("/mi/<token>")
def mi_perfil(token):
    """Página pública y personal de un cliente (milestone 4) — sin
    contraseña, solo con su enlace único. Ve su programa, sesiones y pagos
    (solo lectura), y desde el 2026-07-29 puede confirmar que la sesión que
    Fernando ya le firmó hoy es correcta — ver `mi_confirmar` más abajo.
    El cliente nunca crea ninguna sesión por su cuenta, solo confirma."""
    encontrado = obtener_cliente_por_token(token)
    if encontrado is None:
        return render_template("error.html", mensaje="Este enlace no es válido. Pide uno nuevo a Fernando."), 404

    nombre, cliente = encontrado
    datos = _con_sesiones_restantes({nombre: cliente})[0]
    # El cliente ve lo suyo con la forma que le corresponde: un bono, lo que
    # le queda; una mensualidad, su cuota y las sesiones del mes; una cuenta,
    # lo que lleva hecho. Se construye desde su CICLO EN CURSO, igual que la
    # ficha de Fernando, para que las dos pantallas no puedan discrepar.
    ciclo = obtener_ciclo_actual(nombre)
    resumen = ficha_servicio(
        ciclo,
        sesiones_del_ciclo=datos.get("sesiones_ciclo") or 0,
        sesiones_completadas=datos.get("sesiones_completadas"),
        estado=datos.get("estado") or ESTADO_POR_DEFECTO,
        pendiente_pago=datos.get("pendiente_pago", False),
    )
    return render_template(
        "mi_perfil.html",
        token=token,
        nombre=nombre,
        cliente=datos,
        resumen=resumen,
        entradas=obtener_historial(nombre),
        confirmaciones_hoy=confirmaciones_de_hoy(nombre),
    )


@app.route("/mi/<token>/confirmar")
def mi_confirmar(token):
    """El cliente confirma que la sesión que Fernando ya le firmó hoy es
    correcta. No crea ni modifica ninguna sesión ni toca el bono — solo
    queda anotado que el cliente lo confirmó. El nombre se resuelve
    siempre a partir del token de la URL, nunca de un dato del formulario,
    así que solo se puede confirmar la sesión del cliente dueño del
    enlace.

    Solo por GET, y solo se llega aquí escaneando el QR que Fernando le
    enseña tras firmarle la sesión (decisión del 2026-07-29: se quitó el
    botón de confirmar de la página del cliente — confirmar es algo que
    pasa delante de Fernando, no algo que el cliente haga por su cuenta
    más tarde). Es una excepción consciente a "GET no debe tener efectos
    secundarios": la acción es segura de repetir (como mucho ya estaba
    confirmada) y el token ya hace de autorización."""
    encontrado = obtener_cliente_por_token(token)
    if encontrado is None:
        return render_template("error.html", mensaje="Este enlace no es válido. Pide uno nuevo a Fernando."), 404
    nombre, _cliente = encontrado

    try:
        confirmar_sesion_publica(nombre)
    except sqlite3.OperationalError:
        return render_template(
            "error.html",
            mensaje="No se pudo guardar la confirmación: la base de datos está ocupada. Vuelve a intentarlo.",
        ), 409
    except ValueError:
        # Ya estaba confirmada, o Fernando todavía no ha firmado nada hoy
        # (p. ej. dos pestañas abiertas) — no hace falta mostrar un error,
        # la propia página vuelve a pintar el estado correcto.
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
    """RETIRADA (segunda auditoría, 2026-07-30). Ya no procesa nada.

    Era la actualización diaria automática desde Calendar: descontaba bonos
    y sumaba economía por su cuenta. Desde el 2026-07-22 la fuente activa es
    la firma manual, y Calendar quedó solo como comprobación — pero esta
    ruta seguía viva y su rutina en la nube seguía disparándose cada noche
    (confirmado: `trig_01JZ6et1nsACiTiu9Ho2rnt8` se disparó el 2026-07-29,
    ya desactivado). Eran dos caminos distintos capaces de descontar el
    mismo bono, justo lo que esta auditoría venía a eliminar.

    Se deja respondiendo 410 Gone en vez de borrarla: si algo antiguo
    vuelve a llamarla, queda claro en el registro del servidor que se
    intentó, en vez de fallar con un 404 confuso."""
    return jsonify(
        {
            "error": "retirada",
            "detalle": (
                "La actualización diaria automática desde Calendar está retirada. "
                "Las sesiones se firman a mano en la app; Calendar solo se usa como comprobación "
                "en /admin/verificar-semana."
            ),
        }
    ), 410


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
    if not token_admin_valido(request.headers.get("X-Admin-Token")):
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
    if not token_admin_valido(request.headers.get("X-Admin-Token")):
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


# `/admin/debug` eliminada en la segunda auditoría (2026-07-30): era una
# ruta temporal para depurar la puesta en marcha de la actualización diaria
# de Calendar (2026-07-21). Esa actualización está retirada, así que la ruta
# ya no tenía ningún uso — y era un punto de escritura más (creaba avisos)
# accesible sin la contraseña de Fernando.


@app.route("/avisos")
def avisos():
    avisar_confirmaciones_pendientes()
    lista = listar_avisos_pendientes()
    marcar_todos_leidos()
    conteo_por_tipo: dict[str, int] = {}
    for aviso in lista:
        conteo_por_tipo[aviso["tipo"]] = conteo_por_tipo.get(aviso["tipo"], 0) + 1
    return render_template("avisos.html", avisos=lista, conteo_por_tipo=conteo_por_tipo)


@app.route("/avisos/<int:aviso_id>/resolver", methods=["POST"])
def resolver_aviso_ruta(aviso_id):
    resolver_aviso(aviso_id)
    return redirect(url_for("avisos"))


@app.route("/avisos/resolver-tipo", methods=["POST"])
def resolver_avisos_por_tipo_ruta():
    """Descarta de golpe todos los avisos pendientes de un tipo — útil
    cuando una comprobación nueva genera muchos avisos de golpe (pasó al
    lanzar la de confirmaciones pendientes, 2026-07-29)."""
    resolver_avisos_por_tipo(request.form["tipo"])
    return redirect(url_for("avisos"))


if __name__ == "__main__":
    # debug=False a propósito: esta app va a quedar arrancada de forma
    # permanente (arranque automático), y el modo de depuración de Flask
    # deja accesible una consola que podría ejecutar código arbitrario si
    # algún día la app fuera visible desde la red — ver
    # docs/APRENDIZAJE_WEBAPP.md.
    app.run(debug=False)
