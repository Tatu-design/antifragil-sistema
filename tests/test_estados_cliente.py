"""Estados del cliente: activo, pausado y cancelado (2026-08-01).

Un cliente que deja de entrenar NO se borra: se archiva conservando ficha,
programa, sesiones, historial, economía, deuda y enlace personal, y puede
volver a activo sin crear otra ficha.

`estado` es independiente de `pendiente_pago`: se puede estar pausado
debiendo dinero, o cancelado y al día.

Cada prueba usa un archivo SQLite temporal propio, nunca `datos/antifragil.db`.
"""

import os
import sqlite3
import unittest
from datetime import date
from pathlib import Path
from tempfile import mkstemp

import basedatos
import clientes.repositorio as cr
import economia.registro as er
import firma_publica as fp
import registrar_asistencia as ra


def _bd_temporal() -> Path:
    descriptor, ruta = mkstemp(suffix=".db")
    os.close(descriptor)
    return Path(ruta)


def _borrar(ruta: Path) -> None:
    for sufijo in ("", "-wal", "-shm"):
        candidato = Path(str(ruta) + sufijo)
        try:
            if candidato.exists():
                candidato.unlink()
        except PermissionError:
            pass


class BaseEstados(unittest.TestCase):
    def setUp(self) -> None:
        self.ruta = _bd_temporal()
        basedatos.crear_esquema(self.ruta)
        cr.guardar_programa("Bono 8", 35.0, 8, ruta=self.ruta)
        for nombre in ("Cliente A", "Cliente B", "Cliente C", "Cliente D"):
            cr.crear_cliente(nombre, "Bono 8", 0, False, ruta=self.ruta)
        cr.asegurar_tokens(ruta=self.ruta)

    def tearDown(self) -> None:
        _borrar(self.ruta)

    def _estado(self, nombre: str) -> str:
        return cr.leer_clientes(self.ruta)[nombre]["estado"]


# ---------------------------------------------------------------------------
# Migración
# ---------------------------------------------------------------------------


ESQUEMA_SIN_ESTADO = """
CREATE TABLE programas (
    nombre TEXT PRIMARY KEY, tarifa REAL NOT NULL, sesiones_totales INTEGER NOT NULL
);
CREATE TABLE clientes (
    nombre TEXT PRIMARY KEY,
    tipo_programa TEXT NOT NULL REFERENCES programas(nombre),
    sesiones_completadas INTEGER NOT NULL DEFAULT 0,
    pendiente_pago INTEGER NOT NULL DEFAULT 0,
    token TEXT,
    ciclo_bono INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE historial_sesiones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente TEXT NOT NULL REFERENCES clientes(nombre),
    fecha TEXT NOT NULL, tipo_programa TEXT NOT NULL,
    numero_sesion INTEGER NOT NULL, sesiones_totales INTEGER NOT NULL,
    tarifa REAL, ciclo_bono INTEGER NOT NULL DEFAULT 1
);
"""


class TestMigracionEstado(unittest.TestCase):
    """Parte de una base ANTERIOR a que existiera la columna."""

    def setUp(self) -> None:
        self.ruta = _bd_temporal()
        with sqlite3.connect(self.ruta) as conexion:
            conexion.executescript(ESQUEMA_SIN_ESTADO)
            conexion.execute("INSERT INTO programas VALUES ('Bono 8', 35.0, 8)")
            for i, nombre in enumerate(("Cliente A", "Cliente B", "Cliente C"), start=1):
                conexion.execute(
                    "INSERT INTO clientes (nombre, tipo_programa, sesiones_completadas, pendiente_pago, token) "
                    "VALUES (?, 'Bono 8', ?, ?, ?)",
                    (nombre, i, i % 2, f"token-{i}"),
                )
            conexion.execute(
                "INSERT INTO historial_sesiones (cliente, fecha, tipo_programa, numero_sesion, "
                "sesiones_totales, tarifa) VALUES ('Cliente A', '2026-07-15', 'Bono 8', 1, 8, 35.0)"
            )

    def tearDown(self) -> None:
        _borrar(self.ruta)

    def _foto(self) -> list[tuple]:
        with basedatos.conectar(self.ruta) as conexion:
            return [
                (f["nombre"], f["tipo_programa"], f["sesiones_completadas"], f["pendiente_pago"], f["token"])
                for f in conexion.execute("SELECT * FROM clientes ORDER BY nombre")
            ]

    def test_la_columna_no_existe_antes_de_migrar(self):
        with basedatos.conectar(self.ruta) as conexion:
            columnas = {f["name"] for f in conexion.execute("PRAGMA table_info(clientes)")}
        self.assertNotIn("estado", columnas)

    def test_migrar_deja_a_todos_activos_sin_perder_nada(self):
        antes = self._foto()
        basedatos.crear_esquema(self.ruta)
        despues = self._foto()

        self.assertEqual(antes, despues, "ningún dato anterior puede cambiar")
        self.assertEqual(len(despues), 3, "no puede perderse ni aparecer ningún cliente")
        for datos in cr.leer_clientes(self.ruta).values():
            self.assertEqual(datos["estado"], "activo")

    def test_es_segura_de_repetir(self):
        basedatos.crear_esquema(self.ruta)
        primera = self._foto()
        basedatos.crear_esquema(self.ruta)
        basedatos.crear_esquema(self.ruta)
        self.assertEqual(primera, self._foto())

        with basedatos.conectar(self.ruta) as conexion:
            self.assertEqual(conexion.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(conexion.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_el_historial_sobrevive(self):
        basedatos.crear_esquema(self.ruta)
        self.assertEqual(len(cr.obtener_historial("Cliente A", ruta=self.ruta)), 1)


# ---------------------------------------------------------------------------
# Lectura, alta y cambio de estado
# ---------------------------------------------------------------------------


class TestEstadoDelCliente(BaseEstados):
    def test_los_clientes_nuevos_nacen_activos(self):
        self.assertEqual(self._estado("Cliente A"), "activo")

    def test_cambiar_a_pausado_y_volver(self):
        cr.actualizar_cliente("Cliente A", "Cliente A", "Bono 8", 0, False, ruta=self.ruta, estado="pausado")
        self.assertEqual(self._estado("Cliente A"), "pausado")

        cr.actualizar_cliente("Cliente A", "Cliente A", "Bono 8", 0, False, ruta=self.ruta, estado="activo")
        self.assertEqual(self._estado("Cliente A"), "activo")

    def test_cambiar_a_cancelado_y_volver(self):
        cr.actualizar_cliente("Cliente A", "Cliente A", "Bono 8", 0, False, ruta=self.ruta, estado="cancelado")
        self.assertEqual(self._estado("Cliente A"), "cancelado")

        cr.actualizar_cliente("Cliente A", "Cliente A", "Bono 8", 0, False, ruta=self.ruta, estado="activo")
        self.assertEqual(self._estado("Cliente A"), "activo")

    def test_un_estado_invalido_se_rechaza(self):
        for invalido in ("borrado", "ACTIVO", "", "baja"):
            with self.assertRaises(ValueError):
                cr.validar_estado(invalido)
        with self.assertRaises(ValueError):
            cr.actualizar_cliente("Cliente A", "Cliente A", "Bono 8", 0, False, ruta=self.ruta, estado="baja")

    def test_sin_indicar_estado_no_se_toca(self):
        """Las llamadas anteriores a que existiera la columna siguen valiendo."""
        cr.actualizar_cliente("Cliente A", "Cliente A", "Bono 8", 0, False, ruta=self.ruta, estado="pausado")
        cr.actualizar_cliente("Cliente A", "Cliente A", "Bono 8", 2, True, ruta=self.ruta)
        self.assertEqual(self._estado("Cliente A"), "pausado")

    def test_el_estado_es_independiente_del_pago(self):
        for estado in ("activo", "pausado", "cancelado"):
            for debe in (True, False):
                cr.actualizar_cliente(
                    "Cliente B", "Cliente B", "Bono 8", 0, debe, ruta=self.ruta, estado=estado
                )
                datos = cr.leer_clientes(self.ruta)["Cliente B"]
                self.assertEqual(datos["estado"], estado)
                self.assertEqual(datos["pendiente_pago"], "Sí" if debe else "No")


class TestCancelarNoPierdeNada(BaseEstados):
    def test_al_cancelar_se_conserva_absolutamente_todo(self):
        for dia in (3, 4, 5):
            ra.registrar_sesion_pt("Cliente A", fecha=date(2026, 8, dia), ruta=self.ruta)
        cr.actualizar_cliente("Cliente A", "Cliente A", "Bono 8", 3, True, ruta=self.ruta)

        antes = cr.leer_clientes(self.ruta)["Cliente A"]
        historial_antes = cr.obtener_historial("Cliente A", ruta=self.ruta)
        semana_antes = er.obtener_semana("2026-08-03", ruta=self.ruta)

        cr.actualizar_cliente("Cliente A", "Cliente A", "Bono 8", 3, True, ruta=self.ruta, estado="cancelado")

        despues = cr.leer_clientes(self.ruta)["Cliente A"]
        self.assertEqual(despues["estado"], "cancelado")
        self.assertEqual(despues["tipo_programa"], antes["tipo_programa"])
        self.assertEqual(despues["tarifa"], antes["tarifa"])
        self.assertEqual(despues["sesiones_completadas"], antes["sesiones_completadas"])
        self.assertEqual(despues["pendiente_pago"], antes["pendiente_pago"], "la deuda no se borra al cancelar")
        self.assertEqual(despues["token"], antes["token"], "el enlace personal se conserva")
        self.assertEqual(cr.obtener_historial("Cliente A", ruta=self.ruta), historial_antes)
        self.assertEqual(er.obtener_semana("2026-08-03", ruta=self.ruta), semana_antes)

    def test_reactivar_no_crea_otra_ficha_ni_reinicia_el_bono(self):
        for dia in (3, 4):
            ra.registrar_sesion_pt("Cliente A", fecha=date(2026, 8, dia), ruta=self.ruta)
        cuantos = len(cr.leer_clientes(self.ruta))

        cr.actualizar_cliente("Cliente A", "Cliente A", "Bono 8", 2, False, ruta=self.ruta, estado="cancelado")
        cr.actualizar_cliente("Cliente A", "Cliente A", "Bono 8", 2, False, ruta=self.ruta, estado="activo")

        self.assertEqual(len(cr.leer_clientes(self.ruta)), cuantos, "no aparece ninguna ficha nueva")
        datos = cr.leer_clientes(self.ruta)["Cliente A"]
        self.assertEqual(datos["estado"], "activo")
        self.assertEqual(datos["sesiones_completadas"], 2, "el bono sigue por donde iba")
        self.assertEqual(len(cr.obtener_historial("Cliente A", ruta=self.ruta)), 2)


# ---------------------------------------------------------------------------
# La web: filtros, bloqueo de firma y pantalla
# ---------------------------------------------------------------------------


class TestPantallaYBloqueo(BaseEstados):
    def setUp(self) -> None:
        super().setUp()
        # A: activo al día · B: activo con deuda · C: pausado con deuda
        # D: cancelado al día
        cr.actualizar_cliente("Cliente B", "Cliente B", "Bono 8", 0, True, ruta=self.ruta, estado="activo")
        cr.actualizar_cliente("Cliente C", "Cliente C", "Bono 8", 0, True, ruta=self.ruta, estado="pausado")
        cr.actualizar_cliente("Cliente D", "Cliente D", "Bono 8", 0, False, ruta=self.ruta, estado="cancelado")

        import webapp.app as app_module

        self.app_module = app_module
        self._originales = {
            n: getattr(app_module, n)
            for n in ("leer_clientes", "obtener_historial", "avisar_confirmaciones_pendientes",
                      "contar_no_leidos", "hay_sesion_pendiente_de_confirmar", "confirmaciones_de_hoy",
                      "registrar_sesion_pt", "listar_tipos_programa", "actualizar_cliente",
                      "obtener_ciclo_actual", "obtener_programas_cliente", "configurar_servicio")
        }
        app_module.leer_clientes = lambda ruta=self.ruta: cr.leer_clientes(self.ruta)
        app_module.obtener_historial = lambda n, ruta=self.ruta: cr.obtener_historial(n, ruta=self.ruta)
        app_module.avisar_confirmaciones_pendientes = lambda ruta=self.ruta: None
        app_module.contar_no_leidos = lambda ruta=self.ruta: 0
        app_module.hay_sesion_pendiente_de_confirmar = lambda n, ruta=self.ruta: False
        app_module.confirmaciones_de_hoy = lambda n, ruta=self.ruta: []
        app_module.listar_tipos_programa = lambda ruta=self.ruta: ["Bono 8"]
        app_module.obtener_ciclo_actual = lambda n, conexion=None, ruta=self.ruta: (
            cr.obtener_ciclo_actual(n, ruta=self.ruta)
        )
        app_module.obtener_programas_cliente = lambda n, ruta=self.ruta: (
            cr.obtener_programas_cliente(n, ruta=self.ruta)
        )
        app_module.configurar_servicio = lambda cliente, modalidad, ruta=self.ruta, **kw: (
            cr.configurar_servicio(cliente, modalidad, ruta=self.ruta, **kw)
        )
        # Sin esto, la ruta de guardar escribiría en la base de datos REAL
        # en vez de en la temporal de la prueba.
        app_module.actualizar_cliente = (
            lambda nombre, nuevo_nombre, tipo_programa, sesiones_completadas,
                   pendiente_pago, ruta=self.ruta, estado=None: cr.actualizar_cliente(
                nombre, nuevo_nombre, tipo_programa, sesiones_completadas,
                pendiente_pago, ruta=self.ruta, estado=estado)
        )
        app_module.registrar_sesion_pt = lambda n, clave_idempotencia=None, ruta=self.ruta: (
            ra.registrar_sesion_pt(n, clave_idempotencia=clave_idempotencia, ruta=self.ruta)
        )
        app_module.app.config["TESTING"] = True
        self.cliente = app_module.app.test_client()
        with self.cliente.session_transaction() as sesion:
            sesion["autenticado"] = True
            sesion["csrf"] = "t"

    def tearDown(self) -> None:
        for nombre, funcion in self._originales.items():
            setattr(self.app_module, nombre, funcion)
        super().tearDown()

    def test_la_cabecera_es_solo_lista_de_clientes(self):
        html = self.cliente.get("/").get_data(as_text=True)
        self.assertIn("Lista de clientes", html)
        self.assertNotIn("Antifrágil · Clientes", html)
        self.assertNotIn("Vista en directo desde la base de datos", html)

    def test_el_boton_nuevo_lleva_el_simbolo_mas(self):
        html = self.cliente.get("/").get_data(as_text=True)
        self.assertIn("#i-plus", html, "el icono del + debe estar")
        self.assertIn("boton-nuevo", html)
        self.assertNotIn("iconos.svg", html, "los iconos van incrustados, no en archivo aparte")

    def test_los_cuatro_contadores_son_totales(self):
        html = self.cliente.get("/").get_data(as_text=True)
        for etiqueta in ("Activos", "Pendientes de pago", "Pausados", "Cancelados"):
            self.assertIn(etiqueta, html)
        # 2 activos (A y B), 2 con deuda (B y C), 1 pausado, 1 cancelado
        self.assertIn('data-filtro="activos"', html)
        self.assertRegex(html, r'data-filtro="activos"[\s\S]{0,200}?>2<')
        self.assertRegex(html, r'data-filtro="pendientes"[\s\S]{0,220}?>2<')
        self.assertRegex(html, r'data-filtro="pausados"[\s\S]{0,200}?>1<')
        self.assertRegex(html, r'data-filtro="cancelados"[\s\S]{0,200}?>1<')

    def test_cada_tarjeta_lleva_su_estado_y_su_deuda(self):
        html = self.cliente.get("/").get_data(as_text=True)
        self.assertIn('data-estado="activo"', html)
        self.assertIn('data-estado="pausado"', html)
        self.assertIn('data-estado="cancelado"', html)
        self.assertIn('data-pendiente="si"', html)
        self.assertIn('data-pendiente="no"', html)

    def test_las_tarjetas_ya_no_muestran_tarifa_ni_programa(self):
        html = self.cliente.get("/").get_data(as_text=True)
        lista = html.split('id="lista-clientes"')[1].split("</div>\n\n    <p")[0]
        self.assertNotIn("Bono 8", lista, "el programa no va en la lista general")
        self.assertNotIn("35", lista.replace("35%", ""), "la tarifa tampoco")

    def test_ya_no_se_menciona_el_excel(self):
        html = self.cliente.get("/").get_data(as_text=True)
        self.assertNotIn("Excel", html)

    def test_los_mensajes_de_lista_vacia_estan_disponibles(self):
        html = self.cliente.get("/").get_data(as_text=True)
        for mensaje in ("No hay clientes activos.", "No hay clientes pendientes de pago.",
                        "No hay clientes pausados.", "No hay clientes cancelados."):
            self.assertIn(mensaje, html)

    def test_lo_oculto_se_oculta_de_verdad(self):
        """El filtro esconde tarjetas con el atributo `hidden`, pero
        `.tarjeta-cliente` fija `display: block` y ESO GANA al atributo: sin
        una regla que lo fuerce, pulsar un filtro no ocultaba nada
        (2026-08-01, el fallo que reportó Fernando)."""
        import re
        css = Path("webapp/static/style.css").read_text(encoding="utf-8")
        self.assertRegex(
            css, r"\[hidden\][^{]*\{[^}]*display:\s*none\s*!important",
            "falta la regla que hace que `hidden` gane a cualquier `display` propio",
        )

    def test_los_filtros_son_botones_accesibles(self):
        html = self.cliente.get("/").get_data(as_text=True)
        self.assertIn('aria-pressed="true"', html)
        self.assertIn('aria-pressed="false"', html)
        self.assertEqual(html.count('type="button" class="filtro'), 4)

    def test_el_perfil_de_un_activo_deja_firmar(self):
        html = self.cliente.get("/cliente/Cliente A").get_data(as_text=True)
        self.assertIn("/firmar", html)

    def test_el_perfil_de_un_pausado_no_ofrece_firmar(self):
        html = self.cliente.get("/cliente/Cliente C").get_data(as_text=True)
        self.assertNotIn("/firmar", html)
        self.assertIn("pausado", html)

    def test_el_perfil_de_un_cancelado_no_ofrece_firmar(self):
        html = self.cliente.get("/cliente/Cliente D").get_data(as_text=True)
        self.assertNotIn("/firmar", html)
        self.assertIn("cancelado", html)

    def _intentar_firmar(self, nombre: str):
        return self.cliente.post(
            f"/cliente/{nombre}/firmar", data={"csrf": "t", "clave_idempotencia": "k"}
        )

    def test_el_servidor_bloquea_la_firma_de_un_pausado(self):
        respuesta = self._intentar_firmar("Cliente C")
        self.assertEqual(respuesta.status_code, 409)
        self.assertIn("pausado", respuesta.get_data(as_text=True))

    def test_el_servidor_bloquea_la_firma_de_un_cancelado(self):
        respuesta = self._intentar_firmar("Cliente D")
        self.assertEqual(respuesta.status_code, 409)
        self.assertIn("cancelado", respuesta.get_data(as_text=True))

    def test_un_intento_bloqueado_no_toca_bono_historial_ni_economia(self):
        antes = cr.leer_clientes(self.ruta)["Cliente C"]
        self._intentar_firmar("Cliente C")
        despues = cr.leer_clientes(self.ruta)["Cliente C"]

        self.assertEqual(antes["sesiones_completadas"], despues["sesiones_completadas"])
        self.assertEqual(cr.obtener_historial("Cliente C", ruta=self.ruta), [])
        self.assertEqual(er.listar_meses(self.ruta), [])

    def test_un_activo_si_puede_firmar_por_la_ruta(self):
        respuesta = self._intentar_firmar("Cliente A")
        self.assertEqual(respuesta.status_code, 302)
        self.assertEqual(len(cr.obtener_historial("Cliente A", ruta=self.ruta)), 1)

    def test_editar_datos_ofrece_los_tres_estados(self):
        html = self.cliente.get("/cliente/Cliente A/editar-datos").get_data(as_text=True)
        self.assertIn("Estado del cliente", html)
        for opcion in ("activo", "pausado", "cancelado"):
            self.assertIn(f'value="{opcion}"', html)
        self.assertIn('value="activo" selected', html.replace(" selected", " selected"))

    def test_editar_programa_no_ofrece_cambiar_el_estado(self):
        html = self.cliente.get("/cliente/Cliente C/editar").get_data(as_text=True)
        self.assertNotIn("Estado del cliente", html)
        self.assertIn("Modalidad del servicio", html)

    def test_cambiar_el_programa_de_un_pausado_lo_deja_pausado(self):
        """Lo que de verdad importa: tocar el bono no reactiva a nadie."""
        cr.configurar_servicio(
            "Cliente C", "bono", nombre_servicio="Bono 8",
            sesiones_totales=8, precio_total=280, ruta=self.ruta,
        )
        self.assertEqual(cr.leer_clientes(self.ruta)["Cliente C"]["estado"], "pausado")

    def test_confirmar_muestra_el_cambio_de_estado(self):
        respuesta = self.cliente.post(
            "/cliente/Cliente A/confirmar",
            data={"csrf": "t", "nombre": "Cliente A", "tipo_programa": "Bono 8",
                  "sesiones_completadas": "0", "estado": "pausado"},
        )
        html = respuesta.get_data(as_text=True)
        self.assertIn("Estado", html)
        self.assertIn("Activo", html)
        self.assertIn("Pausado", html)

    def test_guardar_aplica_el_estado(self):
        self.cliente.post(
            "/cliente/Cliente A/guardar",
            data={"csrf": "t", "nombre": "Cliente A", "tipo_programa": "Bono 8",
                  "sesiones_completadas": "0", "pendiente_pago": "no", "estado": "cancelado"},
        )
        self.assertEqual(self._estado("Cliente A"), "cancelado")


if __name__ == "__main__":
    unittest.main()
