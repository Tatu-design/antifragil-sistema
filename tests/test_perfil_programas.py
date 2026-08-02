"""Pruebas de la ficha del cliente y de los bonos concretos (2026-08-02).

El criterio de esta iteración era REGRESIÓN CERO: la pantalla cambia de
aspecto, pero ni un solo número puede moverse. Estas pruebas comprueban
justo eso — que reorganizar la ficha no toca sesiones, dinero ni historial.
"""

import os
import unittest
from datetime import date
from pathlib import Path
from tempfile import mkstemp
from unittest.mock import patch

import basedatos
import clientes.repositorio as cr
import economia.registro as er
import registrar_asistencia as ra
from webapp import app as webapp


class BaseFicha(unittest.TestCase):
    """Una base de datos nueva por prueba. Nunca la real."""

    def setUp(self):
        descriptor, ruta = mkstemp(suffix=".db")
        os.close(descriptor)
        self.ruta = Path(ruta)
        basedatos.crear_esquema(self.ruta)

        with basedatos.transaccion(self.ruta) as conexion:
            conexion.execute(
                "INSERT INTO programas (nombre, tarifa, sesiones_totales) VALUES (?, ?, ?)",
                ("Bono 4", 45.0, 4),
            )
            conexion.execute(
                "INSERT INTO clientes (nombre, tipo_programa, sesiones_completadas, "
                "pendiente_pago, ciclo_bono, estado, token) VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("Ana", "Bono 4", 0, 0, 1, "activo", "tok-ana"),
            )

        self.addCleanup(self._borrar)

    def _borrar(self):
        # En Windows el fichero puede seguir tomado un instante; no es un
        # fallo de la prueba, así que no se hace fracasar por eso.
        for sufijo in ("", "-wal", "-shm"):
            try:
                Path(str(self.ruta) + sufijo).unlink(missing_ok=True)
            except OSError:
                pass

    def firmar(self, veces: int, cuando: date = date(2026, 8, 2)):
        for _ in range(veces):
            ra.registrar_sesion_pt("Ana", fecha=cuando, ruta=self.ruta)


class TestBonosConcretos(BaseFicha):
    def test_un_cliente_nuevo_ya_tiene_su_bono_en_curso(self):
        bonos = cr.obtener_programas_cliente("Ana", ruta=self.ruta)
        self.assertEqual(len(bonos), 1)
        self.assertTrue(bonos[0]["es_actual"])
        self.assertEqual(bonos[0]["ciclo_bono"], 1)

    def test_dos_bonos_iguales_seguidos_no_se_mezclan(self):
        """El caso que motivó todo esto: contratar dos veces el MISMO bono."""
        self.firmar(6)  # 4 cierran el primero, 2 van al segundo

        bonos = cr.obtener_programas_cliente("Ana", ruta=self.ruta)
        self.assertEqual(len(bonos), 2)

        actual, anterior = bonos[0], bonos[1]
        self.assertTrue(actual["es_actual"])
        self.assertEqual(len(anterior["sesiones"]), 4)
        self.assertEqual(len(actual["sesiones"]), 2)
        # El bono cerrado tiene fecha de fin; el que está en curso, no.
        self.assertIsNotNone(anterior["fecha_fin"])
        self.assertIsNone(actual["fecha_fin"])

    def test_el_bono_nuevo_estrena_fecha_de_inicio(self):
        self.firmar(5)
        actual = cr.obtener_programas_cliente("Ana", ruta=self.ruta)[0]
        self.assertEqual(actual["fecha_inicio"], "2026-08-02")

    def test_cada_sesion_guarda_su_hora(self):
        self.firmar(1)
        sesion = cr.obtener_historial("Ana", ruta=self.ruta)[0]
        self.assertRegex(sesion["hora"], r"^\d{2}:\d{2}$")

    def test_renombrar_arrastra_los_bonos(self):
        self.firmar(5)
        cr.actualizar_cliente("Ana", "Ana Ruiz", "Bono 4", 1, False, ruta=self.ruta)

        self.assertEqual(cr.obtener_programas_cliente("Ana", ruta=self.ruta), [])
        self.assertEqual(len(cr.obtener_programas_cliente("Ana Ruiz", ruta=self.ruta)), 2)

    def test_borrar_el_cliente_no_deja_bonos_huerfanos(self):
        self.firmar(5)
        ra.eliminar_cliente_con_historial("Ana", ruta=self.ruta)

        with basedatos.conectar(self.ruta) as conexion:
            sobran = conexion.execute("SELECT COUNT(*) AS n FROM programas_cliente").fetchone()["n"]
        self.assertEqual(sobran, 0)


class TestRegresionEconomica(BaseFicha):
    """Lo importante: la ficha nueva no cambia ni un euro."""

    def _agosto(self):
        return er.obtener_mes(2026, 8, self.ruta)

    def test_el_dinero_es_el_mismo_que_antes_de_los_bonos(self):
        self.firmar(4)
        # 4 sesiones × 45 € = 180 €. Ni más ni menos.
        self.assertEqual(self._agosto()["facturacion_total"], 180.0)
        self.assertEqual(self._agosto()["horas_totales"], 4)

    def test_leer_la_ficha_no_escribe_nada(self):
        self.firmar(4)
        antes = self._agosto()
        historial_antes = cr.obtener_historial("Ana", ruta=self.ruta)

        cr.obtener_programas_cliente("Ana", ruta=self.ruta)

        self.assertEqual(self._agosto(), antes)
        self.assertEqual(cr.obtener_historial("Ana", ruta=self.ruta), historial_antes)

    def test_cambiar_solo_el_pago_no_toca_sesiones_ni_dinero(self):
        self.firmar(2)
        antes = self._agosto()

        cr.actualizar_cliente("Ana", "Ana", "Bono 4", 2, True, ruta=self.ruta)

        self.assertEqual(self._agosto(), antes)
        self.assertEqual(len(cr.obtener_historial("Ana", ruta=self.ruta)), 2)
        self.assertTrue(cr.leer_clientes(self.ruta)["Ana"]["pendiente_pago"])


class TestPantallaFicha(BaseFicha):
    def setUp(self):
        super().setUp()

        self._originales = {
            n: getattr(webapp, n)
            for n in ("leer_clientes", "obtener_historial", "avisar_confirmaciones_pendientes",
                      "contar_no_leidos", "hay_sesion_pendiente_de_confirmar",
                      "confirmaciones_de_hoy", "listar_tipos_programa",
                      "obtener_programas_cliente")
        }
        webapp.leer_clientes = lambda ruta=self.ruta: cr.leer_clientes(self.ruta)
        webapp.obtener_historial = lambda n, ruta=self.ruta: cr.obtener_historial(n, ruta=self.ruta)
        webapp.avisar_confirmaciones_pendientes = lambda ruta=self.ruta: None
        webapp.contar_no_leidos = lambda ruta=self.ruta: 0
        webapp.hay_sesion_pendiente_de_confirmar = lambda n, ruta=self.ruta: False
        webapp.confirmaciones_de_hoy = lambda n, ruta=self.ruta: []
        webapp.listar_tipos_programa = lambda ruta=self.ruta: ["Bono 4"]
        webapp.obtener_programas_cliente = lambda n, ruta=self.ruta: (
            cr.obtener_programas_cliente(n, ruta=self.ruta)
        )
        self.addCleanup(self._restaurar)

        webapp.app.config["TESTING"] = True
        self.cliente = webapp.app.test_client()
        with self.cliente.session_transaction() as sesion:
            sesion["autenticado"] = True
            sesion["csrf"] = "t"

    def _restaurar(self):
        for nombre, funcion in self._originales.items():
            setattr(webapp, nombre, funcion)

    def test_la_ficha_muestra_nombre_estado_y_bonos(self):
        self.firmar(5)
        html = self.cliente.get("/cliente/Ana").get_data(as_text=True)

        self.assertIn("Ana", html)
        self.assertIn("estado-activo", html)
        self.assertIn("Historial de programas · 2", html)

    def test_el_historial_arranca_plegado(self):
        self.firmar(1)
        html = self.cliente.get("/cliente/Ana").get_data(as_text=True)
        self.assertIn('aria-expanded="false"', html)
        self.assertIn('id="lista-bonos" hidden', html)

    def test_las_fechas_se_ven_en_formato_espanol(self):
        self.firmar(1)
        html = self.cliente.get("/cliente/Ana").get_data(as_text=True)
        self.assertIn("02/08/2026", html)
        self.assertNotIn("2026-08-02", html)

    def test_estan_las_dos_acciones_separadas(self):
        html = self.cliente.get("/cliente/Ana").get_data(as_text=True)
        self.assertIn("Editar datos", html)
        self.assertIn("Editar programa", html)
        self.assertIn("/editar-datos", html)

    def test_el_boton_de_copiar_lleva_el_enlace_del_cliente(self):
        html = self.cliente.get("/cliente/Ana").get_data(as_text=True)
        self.assertIn("/mi/tok-ana", html)

    def test_la_zona_peligrosa_no_deja_borrar_con_historial(self):
        self.firmar(1)
        html = self.cliente.get("/cliente/Ana/editar-datos").get_data(as_text=True)
        self.assertNotIn("Borrar este cliente", html)

    def test_sin_historial_si_se_puede_borrar(self):
        html = self.cliente.get("/cliente/Ana/editar-datos").get_data(as_text=True)
        self.assertIn("Borrar este cliente", html)


if __name__ == "__main__":
    unittest.main()
