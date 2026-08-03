"""Reglas de equivalencia que NO se pueden escribir como datos (Fase 3).

Los escenarios de `tests/fixtures/escenarios.json` cubren todo lo que se
puede describir como "parte de aquí, haz esto, comprueba lo otro". Hay cinco
familias de reglas que no caben ahí, y cada una por un motivo concreto:

1. **Autenticación y permisos** — hacen falta peticiones HTTP reales con
   cookies y token CSRF, no llamadas a funciones.
2. **Aislamiento del enlace público** — hay que pedir la página de un cliente
   y comprobar que no aparece ningún otro.
3. **Concurrencia** — hacen falta dos hilos firmando a la vez.
4. **Atomicidad** — hay que provocar un fallo a mitad de una operación.
5. **Precisión de los importes en bruto** — la fotografía de los escenarios
   compara al céntimo (que es la unidad del negocio); aquí se mira el número
   sin redondear, que es lo que cambia al pasar de SQLite a PostgreSQL.

Todas trabajan sobre archivos SQLite temporales. Nunca sobre
`datos/antifragil.db`.
"""

import os
import re
import sqlite3
import threading
import unittest
from datetime import date
from pathlib import Path
from tempfile import mkstemp
from unittest.mock import patch

import basedatos
import clientes.repositorio as cr
import economia.registro as er
import registrar_asistencia as ra
import webapp.auth as auth


class BaseEquivalencia(unittest.TestCase):
    """Base de datos nueva por prueba, con un cliente de bono ya listo."""

    def setUp(self):
        descriptor, ruta = mkstemp(suffix=".db", prefix="equivalencia-")
        os.close(descriptor)
        self.ruta = Path(ruta)
        basedatos.crear_esquema(self.ruta)
        cr.guardar_programa("Bono 8", 45.0, 8, ruta=self.ruta)
        self.addCleanup(self._limpiar)

    def _limpiar(self):
        for sufijo in ("", "-wal", "-shm"):
            try:
                Path(str(self.ruta) + sufijo).unlink(missing_ok=True)
            except OSError:
                # En Windows SQLite puede tardar en soltar el archivo.
                pass

    def alta(self, nombre="Cliente A", pendiente=False):
        cr.crear_cliente(nombre, "Bono 8", 0, pendiente, ruta=self.ruta)

    def token(self, nombre):
        with basedatos.conectar(self.ruta) as conexion:
            return conexion.execute(
                "SELECT token FROM clientes WHERE nombre = ?", (nombre,)
            ).fetchone()["token"]


# ---------------------------------------------------------------------------
# 1 y 2 · Autenticación, permisos y aislamiento del enlace público
# ---------------------------------------------------------------------------


#: Módulos que abren la base de datos por su cuenta. La aplicación web los
#: llama sin indicar ruta, así que caen en `RUTA_POR_DEFECTO` — la real. Para
#: probar la web hay que desviar esa ruta por delante, y NUNCA dejar que una
#: prueba toque `datos/antifragil.db`.
MODULOS_CON_CONEXION = (
    "basedatos",
    "avisos",
    "clientes.repositorio",
    "economia.registro",
    "firma_publica",
    "registrar_asistencia",
    "webapp.auth",
)


def _desviar(original, destino: Path):
    """Envuelve `conectar`/`transaccion` para que la ruta POR DEFECTO apunte a
    la base de datos temporal. Una ruta indicada a mano se respeta tal cual."""

    def envoltorio(ruta=basedatos.RUTA_POR_DEFECTO, *args, **kwargs):
        return original(destino if ruta == basedatos.RUTA_POR_DEFECTO else ruta, *args, **kwargs)

    return envoltorio


class BaseWeb(BaseEquivalencia):
    """Levanta la aplicación Flask real contra la base de datos temporal.

    Se piden páginas de verdad, no se llaman funciones: es la única forma de
    comprobar que lo que protege el servidor lo protege *el servidor*, y no
    un botón escondido en la plantilla — que es exactamente la lección del
    2026-08-04."""

    def setUp(self):
        super().setUp()
        os.environ["ANTIFRAGIL_COOKIES_INSEGURAS"] = "1"
        self.addCleanup(os.environ.pop, "ANTIFRAGIL_COOKIES_INSEGURAS", None)

        import importlib

        for nombre in MODULOS_CON_CONEXION:
            modulo = importlib.import_module(nombre)
            for funcion in ("conectar", "transaccion"):
                original = getattr(modulo, funcion, None)
                if original is None:
                    continue
                parche = patch.object(modulo, funcion, _desviar(original, self.ruta))
                parche.start()
                self.addCleanup(parche.stop)

        import webapp.app as webapp

        self.webapp = webapp
        webapp.app.config["TESTING"] = True
        auth.establecer_password("clave-de-prueba", ruta=self.ruta)
        self.cliente_http = webapp.app.test_client()

    def entrar(self):
        """Entra como Fernando, pasando por el mismo aro que un navegador: el
        propio login exige token CSRF, así que primero hay que pedir la
        página y solo después mandar la contraseña."""
        self.cliente_http.get("/login")
        with self.cliente_http.session_transaction() as sesion:
            csrf = sesion.get("csrf")
        return self.cliente_http.post(
            "/login", data={"password": "clave-de-prueba", "csrf": csrf}, follow_redirects=True
        )


class TestAutenticacionProtegeLoPrivado(BaseWeb):
    """Regla 16 del encargo."""

    RUTAS_PRIVADAS = [
        "/",
        "/economia",
        "/avisos",
        "/cliente/nuevo",
        "/cliente/Cliente A",
        "/cliente/Cliente A/editar",
        "/cliente/Cliente A/editar-datos",
        "/cliente/Cliente A/eliminar",
    ]

    def test_sin_entrar_ninguna_pantalla_privada_responde_contenido(self):
        self.alta()
        for ruta in self.RUTAS_PRIVADAS:
            with self.subTest(ruta):
                respuesta = self.cliente_http.get(ruta)
                self.assertEqual(respuesta.status_code, 302, f"{ruta} no redirige a login")
                self.assertIn("/login", respuesta.headers["Location"])

    def test_tras_entrar_las_mismas_pantallas_se_ven(self):
        self.alta()
        self.entrar()
        for ruta in self.RUTAS_PRIVADAS:
            with self.subTest(ruta):
                self.assertEqual(self.cliente_http.get(ruta).status_code, 200)

    def test_el_enlace_antiguo_del_historial_sigue_llevando_al_perfil(self):
        """`/cliente/<nombre>/historial` es de cuando el historial tenía
        pantalla propia. Redirige al perfil a propósito, y tiene que seguir
        haciéndolo: puede estar guardado en el móvil de Fernando."""
        self.alta()
        self.entrar()
        respuesta = self.cliente_http.get("/cliente/Cliente A/historial")
        self.assertEqual(respuesta.status_code, 302)
        self.assertIn("/cliente/Cliente", respuesta.headers["Location"])
        self.assertNotIn("/login", respuesta.headers["Location"])

    def test_el_enlace_antiguo_tambien_esta_protegido(self):
        self.alta()
        respuesta = self.cliente_http.get("/cliente/Cliente A/historial")
        self.assertEqual(respuesta.status_code, 302)
        self.assertIn("/login", respuesta.headers["Location"])

    def test_salir_vuelve_a_cerrar_todo(self):
        self.alta()
        self.entrar()
        self.cliente_http.get("/logout")
        self.assertEqual(self.cliente_http.get("/").status_code, 302)

    def test_una_contrasena_incorrecta_no_abre_nada(self):
        self.cliente_http.post("/login", data={"password": "no-es"}, follow_redirects=True)
        self.assertEqual(self.cliente_http.get("/").status_code, 302)

    def test_firmar_sin_haber_entrado_no_escribe_nada(self):
        """Esconder el botón no basta: la ruta tiene que negarse igual.

        Se rechaza con 400 porque la comprobación de CSRF va por delante de
        la de sesión — el orden da igual mientras no escriba nada, que es lo
        que de verdad hay que garantizar."""
        self.alta()
        respuesta = self.cliente_http.post("/cliente/Cliente A/firmar")
        self.assertIn(respuesta.status_code, (302, 400))
        self.assertEqual(cr.obtener_historial("Cliente A", ruta=self.ruta), [])

    def test_una_sesion_valida_si_deja_firmar_por_la_ruta(self):
        """La contraparte de la prueba anterior: si el bloqueo fuera
        indiscriminado, tampoco se vería. Aquí sí tiene que escribir."""
        self.alta()
        self.entrar()
        with self.cliente_http.session_transaction() as sesion:
            csrf = sesion["csrf"]
        self.cliente_http.post("/cliente/Cliente A/firmar", data={"csrf": csrf})
        self.assertEqual(len(cr.obtener_historial("Cliente A", ruta=self.ruta)), 1)

    def test_las_rutas_de_maquina_exigen_su_token(self):
        self.assertEqual(self.cliente_http.get("/admin/backup").status_code, 401)


class TestElEnlacePublicoSoloEnsenaSuCliente(BaseWeb):
    """Regla 15 del encargo: el token de un cliente nunca puede destapar a otro."""

    def setUp(self):
        super().setUp()
        self.alta("Cliente A")
        self.alta("Cliente B")
        ra.registrar_sesion_pt("Cliente A", fecha=date(2026, 8, 3), ruta=self.ruta)
        ra.registrar_sesion_pt("Cliente B", fecha=date(2026, 8, 3), ruta=self.ruta)

    def test_la_pagina_de_uno_no_nombra_al_otro(self):
        pagina = self.cliente_http.get(f"/mi/{self.token('Cliente A')}").get_data(as_text=True)
        self.assertIn("Cliente A", pagina)
        self.assertNotIn("Cliente B", pagina)

    def test_el_enlace_publico_no_pide_contrasena(self):
        """Es el único sitio del sistema al que se entra sin entrar."""
        self.assertEqual(self.cliente_http.get(f"/mi/{self.token('Cliente B')}").status_code, 200)

    def test_un_token_inventado_no_ensena_a_nadie(self):
        respuesta = self.cliente_http.get("/mi/token-que-no-existe")
        self.assertIn(respuesta.status_code, (403, 404))
        self.assertNotIn("Cliente A", respuesta.get_data(as_text=True))

    def test_confirmar_con_el_token_de_uno_solo_confirma_lo_suyo(self):
        """El cliente sale del token, nunca de un campo del formulario: por
        eso no se puede pedir que se confirme la sesión de otro."""
        self.cliente_http.get(f"/mi/{self.token('Cliente A')}/confirmar")
        with basedatos.conectar(self.ruta) as conexion:
            confirmados = [f["cliente"] for f in conexion.execute("SELECT cliente FROM firmas_publicas")]
        self.assertEqual(confirmados, ["Cliente A"])

    def test_el_cliente_no_puede_borrar_ni_editar_su_historial(self):
        entrada = cr.obtener_historial("Cliente A", ruta=self.ruta)[0]
        respuesta = self.cliente_http.post(f"/cliente/Cliente A/historial/{entrada['id']}/eliminar")
        self.assertIn(respuesta.status_code, (302, 400))
        self.assertEqual(len(cr.obtener_historial("Cliente A", ruta=self.ruta)), 1)

    def test_capa_1_el_boton_de_firmar_se_autodesactiva(self):
        """La primera capa anti-duplicado vive en el navegador: el botón se
        apaga nada más pulsarlo. Un test no puede pulsar, pero sí comprobar
        que la plantilla la sigue llevando — si alguien la quita al
        rediseñar, esto salta."""
        self.entrar()
        pagina = self.cliente_http.get("/cliente/Cliente A").get_data(as_text=True)
        self.assertRegex(pagina, r"disabled|deshabilit", "el botón de firmar ya no se autodesactiva")

    def test_confirmar_no_toca_el_bono_ni_la_economia(self):
        antes = er.obtener_mes(2026, 8, self.ruta)
        completadas_antes = cr.leer_clientes(self.ruta)["Cliente A"]["sesiones_completadas"]
        self.cliente_http.get(f"/mi/{self.token('Cliente A')}/confirmar")
        self.assertEqual(er.obtener_mes(2026, 8, self.ruta), antes)
        self.assertEqual(
            cr.leer_clientes(self.ruta)["Cliente A"]["sesiones_completadas"], completadas_antes
        )


# ---------------------------------------------------------------------------
# 3 · Las cuatro capas anti-duplicado
# ---------------------------------------------------------------------------


class TestCuatroCapasAntiDuplicado(BaseEquivalencia):
    """Las cuatro, una a una. La capa 1 (el botón que se desactiva) vive en el
    navegador; aquí se comprueba que la plantilla la sigue llevando, porque es
    la única que un test puede ver desde fuera."""

    def test_capa_2_la_misma_peticion_no_se_guarda_dos_veces(self):
        self.alta()
        primera = ra.registrar_sesion_pt("Cliente A", date(2026, 8, 3), "clave-x", self.ruta)
        segunda = ra.registrar_sesion_pt("Cliente A", date(2026, 8, 3), "clave-x", self.ruta)
        self.assertFalse(primera.get("duplicado"))
        self.assertTrue(segunda["duplicado"])
        self.assertEqual(len(cr.obtener_historial("Cliente A", ruta=self.ruta)), 1)

    def test_capa_2_una_segunda_sesion_real_si_se_puede_firmar(self):
        """La protección no puede pasarse de lista: recargar la página genera
        otra clave, y esa segunda sesión es legítima."""
        self.alta()
        ra.registrar_sesion_pt("Cliente A", date(2026, 8, 3), "clave-x", self.ruta)
        ra.registrar_sesion_pt("Cliente A", date(2026, 8, 3), "clave-y", self.ruta)
        self.assertEqual(len(cr.obtener_historial("Cliente A", ruta=self.ruta)), 2)

    def test_capa_3_dos_firmas_a_la_vez_no_repiten_numero_de_sesion(self):
        """Dos hilos firmando al mismo cliente exactamente a la vez. Sin
        `BEGIN IMMEDIATE` las dos leerían el mismo estado y calcularían el
        mismo número."""
        self.alta()
        barrera = threading.Barrier(2)
        errores = []

        def firmar():
            try:
                barrera.wait(timeout=10)
                ra.registrar_sesion_pt("Cliente A", fecha=date(2026, 8, 3), ruta=self.ruta)
            except Exception as error:  # noqa: BLE001
                errores.append(error)

        hilos = [threading.Thread(target=firmar) for _ in range(2)]
        for hilo in hilos:
            hilo.start()
        for hilo in hilos:
            hilo.join(timeout=30)

        self.assertEqual(errores, [], f"una firma simultánea falló: {errores}")
        numeros = sorted(h["numero_sesion"] for h in cr.obtener_historial("Cliente A", ruta=self.ruta))
        self.assertEqual(numeros, [1, 2], "dos firmas a la vez repitieron el número de sesión")
        self.assertEqual(cr.leer_clientes(self.ruta)["Cliente A"]["sesiones_completadas"], 2)

    def test_capa_4_la_base_de_datos_impide_cobrar_dos_veces_el_mes(self):
        """No lo impide el código que llama: lo impide la clave primaria. Se
        comprueba intentando el INSERT directo, saltándose la aplicación."""
        self.alta("Cliente B")
        cr.configurar_servicio(
            "Cliente B", "mensualidad", nombre_servicio="Mensualidad",
            cuota_mensual=720, hoy=date(2026, 8, 3), ruta=self.ruta,
        )
        with basedatos.conectar(self.ruta) as conexion:
            with self.assertRaises(sqlite3.IntegrityError):
                conexion.execute(
                    "INSERT INTO cargos_mensuales (cliente, anio, mes, concepto, ciclo, importe, pagado) "
                    "VALUES ('Cliente B', 2026, 8, 'mensualidad', 2, 720.0, 0)"
                )

    def test_capa_4_la_economia_del_mes_solo_cuenta_una_cuota(self):
        self.alta("Cliente B")
        cr.configurar_servicio(
            "Cliente B", "mensualidad", nombre_servicio="Mensualidad",
            cuota_mensual=720, hoy=date(2026, 8, 3), ruta=self.ruta,
        )
        for _ in range(5):
            cr.asegurar_ciclos_mensuales(2026, 8, ruta=self.ruta)
        self.assertEqual(er.obtener_mes(2026, 8, self.ruta)["facturacion_cuotas"], 720.0)
        self.assertEqual(er.obtener_mes(2026, 8, self.ruta)["cuotas"], 1)


# ---------------------------------------------------------------------------
# 4 · Atomicidad
# ---------------------------------------------------------------------------


class TestAtomicidad(BaseEquivalencia):
    """Reglas 19 y 20 del encargo: o se guarda entero, o no se guarda nada."""

    def test_un_fallo_a_mitad_de_firmar_no_deja_rastro(self):
        self.alta()
        ra.registrar_sesion_pt("Cliente A", fecha=date(2026, 8, 3), ruta=self.ruta)
        antes = {
            "cliente": dict(cr.leer_clientes(self.ruta)["Cliente A"]),
            "historial": cr.obtener_historial("Cliente A", ruta=self.ruta),
            "mes": er.obtener_mes(2026, 8, self.ruta),
            "semana": er.obtener_semana("2026-08-03", self.ruta),
        }

        # Se rompe el último paso de la operación, cuando el bono, el
        # historial y parte de la economía ya se han escrito.
        with patch.object(ra, "_sumar_a_semana", side_effect=RuntimeError("fallo provocado")):
            with self.assertRaises(RuntimeError):
                ra.registrar_sesion_pt("Cliente A", fecha=date(2026, 8, 3), ruta=self.ruta)

        self.assertEqual(dict(cr.leer_clientes(self.ruta)["Cliente A"]), antes["cliente"])
        self.assertEqual(cr.obtener_historial("Cliente A", ruta=self.ruta), antes["historial"])
        self.assertEqual(er.obtener_mes(2026, 8, self.ruta), antes["mes"])
        self.assertEqual(er.obtener_semana("2026-08-03", self.ruta), antes["semana"])

    def test_un_fallo_a_mitad_de_borrar_no_desincroniza_la_economia(self):
        self.alta()
        for _ in range(3):
            ra.registrar_sesion_pt("Cliente A", fecha=date(2026, 8, 3), ruta=self.ruta)
        antes_mes = er.obtener_mes(2026, 8, self.ruta)
        entrada = cr.obtener_historial("Cliente A", ruta=self.ruta)[0]

        with patch.object(ra, "_sumar_a_semana", side_effect=RuntimeError("fallo provocado")):
            with self.assertRaises(RuntimeError):
                ra.eliminar_sesion_pt(entrada["id"], ruta=self.ruta)

        self.assertEqual(len(cr.obtener_historial("Cliente A", ruta=self.ruta)), 3)
        self.assertEqual(er.obtener_mes(2026, 8, self.ruta), antes_mes)

    def test_historial_y_economia_siempre_dicen_lo_mismo(self):
        """Tras una tanda de operaciones mezcladas, la comprobación interna
        del propio sistema no debe encontrar ninguna discrepancia."""
        self.alta("Cliente A")
        self.alta("Cliente B")
        for fecha in (date(2026, 8, 3), date(2026, 8, 4), date(2026, 8, 5)):
            ra.registrar_sesion_pt("Cliente A", fecha=fecha, ruta=self.ruta)
            ra.registrar_sesion_pt("Cliente B", fecha=fecha, ruta=self.ruta)
        ra.registrar_clase_grupo("lidomare", fecha=date(2026, 8, 4), ruta=self.ruta)
        ra.eliminar_sesion_pt(cr.obtener_historial("Cliente B", ruta=self.ruta)[0]["id"], ruta=self.ruta)

        discrepancias = er.verificar_sincronizacion_semana(date(2026, 8, 3), date(2026, 8, 9), self.ruta)
        self.assertEqual(discrepancias, [])


# ---------------------------------------------------------------------------
# 5 · Precisión de los importes sin redondear
# ---------------------------------------------------------------------------


class TestPrecisionDeLosImportes(BaseEquivalencia):
    """Regla 18 del encargo, mirada de cerca.

    En SQLite todo el dinero se guarda como coma flotante (`REAL`). En
    PostgreSQL será `NUMERIC(10,2)`, que es exacto. Estas pruebas fijan qué
    diferencias hay HOY, para que el script de migración pueda comprobar que
    ninguna cifra se mueve al pasar de un sitio al otro."""

    def _bono(self, precio_total, sesiones):
        self.alta()
        cr.configurar_servicio(
            "Cliente A", "bono", nombre_servicio="Bono", sesiones_totales=sesiones,
            precio_total=precio_total, hoy=date(2026, 8, 3), ruta=self.ruta,
        )

    def test_el_precio_por_sesion_se_redondea_al_centimo(self):
        self._bono(100, 3)
        self.assertEqual(cr.obtener_ciclo_actual("Cliente A", ruta=self.ruta)["tarifa"], 33.33)

    def test_un_bono_consumido_entero_no_suma_su_precio_total(self):
        """100 € entre 3 son 33,33 €, y 3 × 33,33 son 99,99. Falta un
        céntimo, y es correcto: la facturación sale de las sesiones hechas,
        no del precio del paquete. La versión nueva tiene que dar 99,99
        también — si diera 100, estaría cambiando la regla."""
        self._bono(100, 3)
        for _ in range(3):
            ra.registrar_sesion_pt("Cliente A", fecha=date(2026, 8, 3), ruta=self.ruta)
        self.assertEqual(er.obtener_mes(2026, 8, self.ruta)["facturacion_total"], 99.99)

    def test_una_suma_con_decimales_no_arrastra_basura_al_centimo(self):
        """20,10 × 3 en coma flotante da 60.300000000000004. Al céntimo son
        60,30. Se comprueba que la diferencia se queda por debajo del
        céntimo, que es lo que hay que garantizar al migrar."""
        self._bono(60.30, 3)
        for _ in range(3):
            ra.registrar_sesion_pt("Cliente A", fecha=date(2026, 8, 3), ruta=self.ruta)
        total = er.obtener_mes(2026, 8, self.ruta)["facturacion_total"]
        self.assertAlmostEqual(total, 60.30, places=2)
        self.assertEqual(round(total, 2), 60.30)

    def test_el_precio_medio_por_hora_no_divide_por_cero(self):
        self.alta()
        mes = er.obtener_mes(2026, 8, self.ruta)
        self.assertIsNone(mes)

    def test_las_tarifas_se_guardan_como_numero_no_como_texto(self):
        """Si una tarifa se guardara como texto, PostgreSQL la rechazaría o
        la convertiría en silencio. Mejor saberlo ahora."""
        self._bono(360, 8)
        ra.registrar_sesion_pt("Cliente A", fecha=date(2026, 8, 3), ruta=self.ruta)
        with basedatos.conectar(self.ruta) as conexion:
            tipos = conexion.execute(
                "SELECT typeof(tarifa) AS t FROM historial_sesiones WHERE tarifa IS NOT NULL"
            ).fetchall()
        self.assertTrue(tipos)
        for fila in tipos:
            self.assertIn(fila["t"], ("real", "integer"))


# ---------------------------------------------------------------------------
# 6 · El tri-estado del cobro
# ---------------------------------------------------------------------------


class TestPagadoNuloNoEsDeuda(BaseEquivalencia):
    """`pagado = NULL` significa "nunca se registró", no "sin pagar".

    Es la diferencia entre enseñarle a Fernando una deuda que no existe y no
    enseñársela. En PostgreSQL hay que resistir la tentación de poner esa
    columna `NOT NULL DEFAULT false`, que borraría la distinción."""

    def _ciclo_legacy(self, pagado):
        self.alta()
        with basedatos.transaccion(self.ruta) as conexion:
            conexion.execute(
                "INSERT INTO programas_cliente (cliente, ciclo_bono, tipo_programa, modalidad, tarifa, "
                "sesiones_totales, fecha_inicio, fecha_fin, pagado) "
                "VALUES ('Cliente A', 0, 'Bono 8', 'bono', 45.0, 8, '2026-06-01', '2026-06-28', ?)",
                (pagado,),
            )

    def test_un_ciclo_con_cobro_sin_registrar_no_cuenta_como_deuda(self):
        self._ciclo_legacy(None)
        self.assertEqual(cr.deuda_pendiente("Cliente A", ruta=self.ruta), [])
        self.assertEqual(cr.leer_clientes(self.ruta)["Cliente A"]["ciclos_pendientes"], 0)

    def test_un_ciclo_cerrado_y_sin_cobrar_si_cuenta_como_deuda(self):
        self._ciclo_legacy(0)
        self.assertEqual(len(cr.deuda_pendiente("Cliente A", ruta=self.ruta)), 1)
        self.assertEqual(cr.leer_clientes(self.ruta)["Cliente A"]["ciclos_pendientes"], 1)

    def test_un_ciclo_cerrado_y_cobrado_no_cuenta(self):
        self._ciclo_legacy(1)
        self.assertEqual(cr.deuda_pendiente("Cliente A", ruta=self.ruta), [])
        self.assertEqual(cr.leer_clientes(self.ruta)["Cliente A"]["ciclos_pendientes"], 0)

    def test_los_tres_valores_se_conservan_tal_cual(self):
        """Ni se normalizan ni se rellenan: el nulo sigue siendo nulo."""
        for valor in (None, 0, 1):
            with self.subTest(valor):
                self.setUp()
                self._ciclo_legacy(valor)
                with basedatos.conectar(self.ruta) as conexion:
                    guardado = conexion.execute(
                        "SELECT pagado FROM programas_cliente WHERE cliente='Cliente A' AND ciclo_bono=0"
                    ).fetchone()["pagado"]
                self.assertEqual(guardado, valor)


class TestTarifaNulaEsHoraSinDinero(BaseEquivalencia):
    """`tarifa = NULL` en una sesión significa "se trabajó, no cobra aparte".
    No es 0 €, y confundirlos rompería la mensualidad."""

    def setUp(self):
        super().setUp()
        cr.crear_cliente("Cliente B", "Bono 8", 0, False, ruta=self.ruta)
        cr.configurar_servicio(
            "Cliente B", "mensualidad", nombre_servicio="Mensualidad",
            cuota_mensual=720, hoy=date(2026, 8, 3), ruta=self.ruta,
        )
        for _ in range(3):
            ra.registrar_sesion_pt("Cliente B", fecha=date(2026, 8, 3), ruta=self.ruta)

    def test_las_sesiones_se_guardan_sin_importe(self):
        historial = cr.obtener_historial("Cliente B", ruta=self.ruta)
        self.assertEqual(len(historial), 3)
        for entrada in historial:
            self.assertIsNone(entrada["tarifa"])

    def test_cuentan_como_hora_trabajada(self):
        self.assertEqual(er.obtener_mes(2026, 8, self.ruta)["horas_totales"], 3)

    def test_el_dinero_del_mes_es_la_cuota_no_las_sesiones(self):
        mes = er.obtener_mes(2026, 8, self.ruta)
        self.assertEqual(mes["facturacion_total"], 720.0)
        self.assertEqual(mes["facturacion_cuotas"], 720.0)

    def test_nulo_y_cero_no_son_lo_mismo(self):
        """Si el sistema tratara `NULL` como 0 €, una sesión de mensualidad
        aparecería en el desglose por tarifas con importe 0 — y no aparece."""
        with basedatos.conectar(self.ruta) as conexion:
            ceros = conexion.execute(
                "SELECT COUNT(*) AS n FROM historial_sesiones WHERE tarifa = 0"
            ).fetchone()["n"]
        self.assertEqual(ceros, 0)


class TestSesionesTotalesCeroEsSinLimite(BaseEquivalencia):
    """`sesiones_totales = 0` significa "sin tope", no "cero sesiones".

    Es exactamente el malentendido que dejó a Fernando sin el botón de firmar
    el 2026-08-04, porque 0 es falso en una condición."""

    def setUp(self):
        super().setUp()
        cr.crear_cliente("Cliente D", "Bono 8", 0, False, ruta=self.ruta)
        cr.configurar_servicio(
            "Cliente D", "cuenta", nombre_servicio="Cuenta", tarifa=35,
            hoy=date(2026, 8, 3), ruta=self.ruta,
        )

    def test_se_puede_firmar_muy_por_encima_de_cualquier_tope(self):
        for _ in range(25):
            ra.registrar_sesion_pt("Cliente D", fecha=date(2026, 8, 3), ruta=self.ruta)
        self.assertEqual(len(cr.obtener_historial("Cliente D", ruta=self.ruta)), 25)

    def test_no_renueva_nunca_por_consumo(self):
        for _ in range(25):
            ra.registrar_sesion_pt("Cliente D", fecha=date(2026, 8, 3), ruta=self.ruta)
        ciclo = cr.obtener_ciclo_actual("Cliente D", ruta=self.ruta)
        self.assertEqual(ciclo["ciclo_bono"], 2)  # el 1 es el bono del alta
        self.assertEqual(ciclo["modalidad"], "cuenta")

    def test_no_habla_de_sesiones_restantes(self):
        from servicios.modalidades import tiene_tope

        self.assertFalse(tiene_tope("cuenta"))

    def test_el_dinero_crece_con_cada_sesion(self):
        for esperado in (35.0, 70.0, 105.0):
            ra.registrar_sesion_pt("Cliente D", fecha=date(2026, 8, 3), ruta=self.ruta)
            self.assertEqual(er.obtener_mes(2026, 8, self.ruta)["facturacion_total"], esperado)


class TestAjustesHistoricosAnterioresAlRegistroDeFechas(BaseEquivalencia):
    """Las semanas anteriores al 2026-07-22 tienen huecos reales: sesiones
    cobradas cuya fecha nunca se guardó. `ajustes_mensuales` las conserva.

    La regla que la migración NO puede romper: el ajuste se SUMA al mes pero
    se muestra por separado con su motivo. Nunca se esconde dentro del total,
    y nunca se "arregla" inventando fechas."""

    def setUp(self):
        super().setUp()
        self.alta()
        ra.registrar_sesion_pt("Cliente A", fecha=date(2026, 7, 29), ruta=self.ruta)
        er.registrar_ajuste_mensual(
            2026, 7, 112.50, 3, "Sesiones cobradas antes del registro de fechas", ruta=self.ruta
        )

    def test_el_mes_suma_lo_real_y_el_ajuste(self):
        mes = er.obtener_mes(2026, 7, self.ruta)
        self.assertEqual(mes["facturacion_total"], 45.0 + 112.50)
        self.assertEqual(mes["horas_totales"], 1 + 3)

    def test_el_ajuste_se_ve_por_separado_con_su_motivo(self):
        mes = er.obtener_mes(2026, 7, self.ruta)
        self.assertEqual(mes["ajuste_importe"], 112.50)
        self.assertEqual(mes["ajuste_horas"], 3)
        self.assertEqual(len(mes["ajustes"]), 1)
        self.assertIn("antes del registro de fechas", mes["ajustes"][0]["motivo"])

    def test_repetirlo_no_lo_acumula(self):
        for _ in range(3):
            er.registrar_ajuste_mensual(
                2026, 7, 112.50, 3, "Sesiones cobradas antes del registro de fechas", ruta=self.ruta
            )
        self.assertEqual(er.obtener_mes(2026, 7, self.ruta)["ajuste_importe"], 112.50)

    def test_un_ajuste_a_cero_lo_retira(self):
        er.registrar_ajuste_mensual(2026, 7, 0, 0, "corrección", ruta=self.ruta)
        mes = er.obtener_mes(2026, 7, self.ruta)
        self.assertEqual(mes["ajuste_importe"], 0)
        self.assertEqual(mes["facturacion_total"], 45.0)

    def test_un_ajuste_exige_motivo_escrito(self):
        with self.assertRaises(ValueError):
            er.registrar_ajuste_mensual(2026, 7, 50, 1, "   ", ruta=self.ruta)

    def test_un_mes_que_solo_existe_por_su_ajuste_no_desaparece(self):
        """Facturación real de antes del registro de fechas, sin ninguna
        sesión detrás. Si el mes no apareciera, ese dinero se perdería."""
        er.registrar_ajuste_mensual(2026, 6, 355.0, 10, "Junio, sin fechas registradas", ruta=self.ruta)
        meses = {(m["anio"], m["mes"]) for m in er.listar_meses(self.ruta)}
        self.assertIn((2026, 6), meses)
        self.assertEqual(er.obtener_mes(2026, 6, self.ruta)["facturacion_total"], 355.0)


class TestZonaHoraria(BaseEquivalencia):
    """La fecha de una sesión es la de Madrid, no la del servidor.

    Vercel corre en UTC. Entre medianoche y las 2 de la madrugada en Madrid,
    un servidor en UTC todavía estaría en "ayer" — y firmaría la sesión con
    la fecha equivocada."""

    def test_la_fecha_de_negocio_es_la_de_madrid(self):
        from zona_horaria import ahora_negocio, hoy_negocio

        self.assertEqual(str(ahora_negocio().tzinfo), "Europe/Madrid")
        self.assertEqual(hoy_negocio(), ahora_negocio().date())

    def test_firmar_sin_fecha_usa_la_fecha_de_negocio(self):
        from zona_horaria import hoy_negocio

        self.alta()
        ra.registrar_sesion_pt("Cliente A", ruta=self.ruta)
        entrada = cr.obtener_historial("Cliente A", ruta=self.ruta)[0]
        self.assertEqual(entrada["fecha"], hoy_negocio().isoformat())

    def test_la_hora_guardada_tiene_formato_de_reloj(self):
        self.alta()
        ra.registrar_sesion_pt("Cliente A", ruta=self.ruta)
        entrada = cr.obtener_historial("Cliente A", ruta=self.ruta)[0]
        self.assertRegex(entrada["hora"], r"^\d{2}:\d{2}$")
